const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const { jwtSecret, jwtExpiresIn, frontendUrl } = require('../config/env');
const { sendPasswordResetEmail } = require('../services/email.service');

const REFRESH_TOKEN_EXPIRES_DAYS = 30;

// A valid bcrypt hash (cost 12) used to spend equivalent time on the
// user-not-found / pending-account paths, so login timing can't be used to
// enumerate which emails belong to real, set-up accounts.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('password-enumeration-guard', 12);

async function createRefreshToken(userId) {
  const token = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { token, userId, expiresAt } });
  return token;
}

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

async function getInvite(req, res, next) {
  try {
    const invite = await prisma.inviteToken.findUnique({
      where: { token: req.params.token },
    });

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }
    if (invite.usedAt) {
      return res.status(400).json({ error: 'Invite has already been used' });
    }
    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invite has expired' });
    }

    const user = await prisma.user.findUnique({
      where: { email: invite.email },
      select: { firstName: true, lastName: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function acceptInvite(req, res, next) {
  try {
    const invite = await prisma.inviteToken.findUnique({
      where: { token: req.params.token },
    });

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }
    if (invite.usedAt) {
      return res.status(400).json({ error: 'Invite has already been used' });
    }
    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invite has expired' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
    if (!existingUser) {
      return res.status(404).json({ error: 'User account not found. Please contact your administrator.' });
    }

    const passwordHash = await bcrypt.hash(req.body.password, 12);

    const nameUpdate = {
      firstName: req.body.firstName,
      ...(req.body.lastName !== undefined && { lastName: req.body.lastName }),
    };

    // Atomically claim the token and update the user in one transaction.
    // If the user update fails the token claim is rolled back, allowing a retry.
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        const { count } = await tx.inviteToken.updateMany({
          where: { token: req.params.token, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (count === 0) {
          const err = new Error('Invite has already been used');
          err.clientStatus = 400;
          throw err;
        }
        const updated = await tx.user.update({
          where: { email: invite.email },
          data: { passwordHash, ...nameUpdate },
        });
        // Revoke any pre-existing sessions (e.g. re-invited account) before issuing new ones
        await tx.refreshToken.deleteMany({ where: { userId: updated.id } });
        return updated;
      });
    } catch (txErr) {
      if (txErr.clientStatus) return res.status(txErr.clientStatus).json({ error: txErr.message });
      throw txErr;
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, {
      expiresIn: jwtExpiresIn,
      algorithm: 'HS256',
    });

    const refreshToken = await createRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ token });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.body.email },
    });

    // Only a fully set-up, active account can authenticate. For every other case
    // we still run one bcrypt compare (against a dummy hash) and return the same
    // generic error, so neither the response nor its timing reveals whether the
    // email exists or is invite-pending.
    const canLogin = user && user.isActive && user.passwordHash !== 'INVITE_PENDING';
    const passwordMatch = await bcrypt.compare(
      req.body.password,
      canLogin ? user.passwordHash : DUMMY_PASSWORD_HASH,
    );

    if (!canLogin || !passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, {
      expiresIn: jwtExpiresIn,
      algorithm: 'HS256',
    });

    const refreshToken = await createRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    res.json({ token });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const tokenValue = req.cookies.refreshToken;
    if (!tokenValue) return res.status(401).json({ error: 'No refresh token' });

    const stored = await prisma.refreshToken.findUnique({ where: { token: tokenValue } });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Rotate atomically: mark old used, verify user, create new token in one transaction
    let user, newRefreshToken;
    try {
      ({ user, newRefreshToken } = await prisma.$transaction(async (tx) => {
        const { count } = await tx.refreshToken.updateMany({
          where: { id: stored.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (count === 0) {
          const err = new Error('Invalid or expired refresh token');
          err.clientStatus = 401;
          throw err;
        }
        const u = await tx.user.findUnique({
          where: { id: stored.userId },
          select: { id: true, role: true, isActive: true },
        });
        if (!u || !u.isActive) {
          const err = new Error('User not found');
          err.clientStatus = 401;
          throw err;
        }
        const token = crypto.randomBytes(40).toString('hex');
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
        await tx.refreshToken.create({ data: { token, userId: u.id, expiresAt } });
        return { user: u, newRefreshToken: token };
      }));
    } catch (txErr) {
      if (txErr.clientStatus) return res.status(txErr.clientStatus).json({ error: txErr.message });
      throw txErr;
    }

    const newJwt = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn, algorithm: 'HS256' });
    setRefreshCookie(res, newRefreshToken);
    res.json({ token: newJwt });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const tokenValue = req.cookies.refreshToken;
    if (tokenValue) {
      await prisma.refreshToken.updateMany({
        where: { token: tokenValue, usedAt: null },
        data: { usedAt: new Date() },
      });
    }
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    // Always return 200 to prevent user enumeration
    if (!user || !user.isActive) {
      return res.json({ message: 'If that email exists, a reset link has been sent' });
    }

    // Invalidate any existing unused tokens for this email
    await prisma.passwordResetToken.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: { token, email, expiresAt },
    });

    const resetUrl = `${frontendUrl}/reset-password/${token}`;

    try {
      await sendPasswordResetEmail(email, resetUrl);
    } catch (emailErr) {
      console.error('Failed to send password reset email:', emailErr);
      return res.status(500).json({ error: 'Could not send reset email. Please try again.' });
    }

    res.json({ message: 'If that email exists, a reset link has been sent' });
  } catch (err) {
    next(err);
  }
}

async function validateResetToken(req, res, next) {
  try {
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: req.params.token },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    }

    res.json({ valid: true });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: req.params.token },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    }

    const passwordHash = await bcrypt.hash(req.body.password, 12);

    // Atomically claim the token and update the password in one transaction.
    // If the user update fails the token claim is rolled back, allowing a retry.
    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.passwordResetToken.updateMany({
          where: { token: req.params.token, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (count === 0) {
          const err = new Error('Reset link is invalid or has expired');
          err.clientStatus = 400;
          throw err;
        }
        const user = await tx.user.update({
          where: { email: resetToken.email },
          data: { passwordHash },
        });
        // Revoke all sessions: a stolen refresh token must not survive a password reset
        await tx.refreshToken.deleteMany({ where: { userId: user.id } });
      });
    } catch (txErr) {
      if (txErr.clientStatus) return res.status(txErr.clientStatus).json({ error: txErr.message });
      throw txErr;
    }

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getInvite, acceptInvite, login, refresh, logout, forgotPassword, validateResetToken, resetPassword };

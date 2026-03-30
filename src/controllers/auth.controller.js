const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const { jwtSecret, jwtExpiresIn, frontendUrl } = require('../config/env');
const { sendPasswordResetEmail } = require('../services/email.service');

const REFRESH_TOKEN_EXPIRES_DAYS = 30;

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
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
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

    // Atomically claim the token — only succeeds if usedAt is still null
    const { count } = await prisma.inviteToken.updateMany({
      where: { token: req.params.token, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (count === 0) {
      return res.status(400).json({ error: 'Invite has already been used' });
    }

    const nameUpdate = {
      firstName: req.body.firstName,
      ...(req.body.lastName !== undefined && { lastName: req.body.lastName }),
    };

    const user = await prisma.user.update({
      where: { email: invite.email },
      data: { passwordHash, ...nameUpdate },
    });

    const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, {
      expiresIn: jwtExpiresIn,
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

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.passwordHash === 'INVITE_PENDING') {
      return res.status(401).json({ error: 'Account setup is not complete. Please check your invite email.' });
    }

    const passwordMatch = await bcrypt.compare(req.body.password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, {
      expiresIn: jwtExpiresIn,
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

    // Rotate: invalidate old, issue new
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } });

    const user = await prisma.user.findUnique({
      where: { id: stored.userId },
      select: { id: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found' });

    const newJwt = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
    const newRefreshToken = await createRefreshToken(user.id);
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
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
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

    // Atomically claim the token
    const { count } = await prisma.passwordResetToken.updateMany({
      where: { token: req.params.token, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (count === 0) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    }

    await prisma.user.update({
      where: { email: resetToken.email },
      data: { passwordHash },
    });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getInvite, acceptInvite, login, refresh, logout, forgotPassword, validateResetToken, resetPassword };

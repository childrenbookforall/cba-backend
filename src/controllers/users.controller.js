const prisma = require('../prisma/client');
const { uploadMedia, deleteMedia } = require('../services/upload.service');

async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        bio: true,
        birthday: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const data = {};
    if ('bio' in req.body) data.bio = req.body.bio;
    if ('birthday' in req.body) {
      data.birthday = req.body.birthday ? new Date(req.body.birthday) : null;
    }

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        bio: true,
        birthday: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const existing = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { avatarUrl: true },
    });

    const avatarUrl = await uploadMedia(req.file.buffer, 'avatars');

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { avatarUrl },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        bio: true,
        birthday: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
      },
    });

    if (existing.avatarUrl) {
      await deleteMedia(existing.avatarUrl).catch((err) =>
        console.error('Failed to delete old avatar from Cloudinary:', err)
      );
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function getUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function searchUsers(req, res, next) {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    let candidateIds;

    if (req.query.groupId) {
      // Scope to a specific group — verify membership first
      const membership = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: req.user.userId, groupId: req.query.groupId } },
      });
      if (!membership) return res.status(403).json({ error: 'You are not a member of this group' });

      const members = await prisma.groupMember.findMany({
        where: { groupId: req.query.groupId },
        select: { userId: true },
      });
      candidateIds = members.map((m) => m.userId).filter((id) => id !== req.user.userId);
    } else {
      // Fall back to all users sharing any group with the requester
      const memberships = await prisma.groupMember.findMany({
        where: { userId: req.user.userId },
        select: { groupId: true },
      });
      const groupIds = memberships.map((m) => m.groupId);
      if (groupIds.length === 0) return res.json([]);

      const sharedMembers = await prisma.groupMember.findMany({
        where: { groupId: { in: groupIds } },
        select: { userId: true },
        distinct: ['userId'],
      });
      candidateIds = sharedMembers.map((m) => m.userId).filter((id) => id !== req.user.userId);
    }

    if (candidateIds.length === 0) return res.json([]);

    const users = await prisma.user.findMany({
      where: {
        id: { in: candidateIds },
        isActive: true,
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      take: 5,
    });

    res.json(users);
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateMe, uploadAvatar, getUser, searchUsers };

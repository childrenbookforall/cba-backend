const prisma = require('../prisma/client');
const { uploadMedia, deleteMedia } = require('../services/upload.service');
const { getAccessibleGroup } = require('../lib/groupAccess');

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
        badges: true,
        canInitiateMessages: true,
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
        badges: true,
        canInitiateMessages: true,
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
        badges: true,
        canInitiateMessages: true,
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
        badges: true,
        createdAt: true,
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
      // Scope to a specific group — verify access first
      const group = await getAccessibleGroup(req.user.userId, req.query.groupId);
      if (!group) return res.status(403).json({ error: 'You do not have access to this group' });

      if (group.isPublic) {
        // Public group — every active user is mentionable
        candidateIds = null;
      } else {
        const members = await prisma.groupMember.findMany({
          where: { groupId: req.query.groupId },
          select: { userId: true },
        });
        candidateIds = members.map((m) => m.userId).filter((id) => id !== req.user.userId);
      }
    } else {
      // Every user shares the public groups, so if any exist all active users are searchable
      const publicCount = await prisma.group.count({ where: { isPublic: true } });
      if (publicCount > 0) {
        candidateIds = null;
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
    }

    if (candidateIds !== null && candidateIds.length === 0) return res.json([]);

    const users = await prisma.user.findMany({
      where: {
        id: candidateIds !== null ? { in: candidateIds } : { not: req.user.userId },
        isActive: true,
        OR: [
          { firstName: { startsWith: q, mode: 'insensitive' } },
          { lastName: { startsWith: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      orderBy: { firstName: 'asc' },
      take: 5,
    });

    res.json(users);
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateMe, uploadAvatar, getUser, searchUsers };

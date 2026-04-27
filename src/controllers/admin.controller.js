const crypto = require('crypto');
const prisma = require('../prisma/client');
const { sendInviteEmail } = require('../services/email.service');
const { deleteMedia } = require('../services/upload.service');
const { frontendUrl } = require('../config/env');
const { sendPush } = require('../services/push.service');

// ── Users ────────────────────────────────────────────────────────────────────

async function createUser(req, res, next) {
  try {
    const { firstName, lastName, email } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const user = await prisma.user.create({
      data: { firstName, lastName, email, passwordHash: 'INVITE_PENDING' },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true, createdAt: true },
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

async function sendInvite(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await prisma.inviteToken.create({
      data: { token, email: user.email, createdById: req.user.userId, expiresAt },
    });

    const inviteUrl = `${frontendUrl}/invite/${token}`;

    try {
      await sendInviteEmail(user.email, inviteUrl);
    } catch (emailErr) {
      console.error('Failed to send invite email:', emailErr);
      return res.status(500).json({ error: 'Invite token created but email could not be sent. Please try resending.' });
    }

    res.status(201).json({ message: 'Invite sent', inviteUrl });
  } catch (err) {
    next(err);
  }
}

const ADMIN_LIST_LIMIT = 20;

async function listUsers(req, res, next) {
  try {
    const cursor = req.query.cursor;

    const rawUsers = await prisma.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        passwordHash: true,
      },
      orderBy: { createdAt: 'desc' },
      take: ADMIN_LIST_LIMIT,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const users = rawUsers.map(({ passwordHash, ...u }) => ({
      ...u,
      invitePending: passwordHash === 'INVITE_PENDING',
    }));

    const nextCursor = users.length === ADMIN_LIST_LIMIT ? users[users.length - 1].id : null;

    res.json({ users, nextCursor });
  } catch (err) {
    next(err);
  }
}

async function suspendUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.id === req.user.userId) {
      return res.status(400).json({ error: 'You cannot suspend yourself' });
    }

    const updated = await prisma.user.update({
      where: { id: req.params.userId },
      data: { isActive: !user.isActive },
      select: { id: true, isActive: true },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

async function deleteUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.id === req.user.userId) {
      return res.status(400).json({ error: 'You cannot delete yourself' });
    }

    // Capture media URLs before deleting — cascade will remove post records
    const photoPosts = await prisma.post.findMany({
      where: { userId: req.params.userId, type: 'photo' },
      select: { mediaUrl: true, mediaUrls: true },
    });

    try {
      await prisma.user.delete({ where: { id: req.params.userId } });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
      throw err;
    }

    // Best-effort Cloudinary cleanup after DB delete succeeds
    const urlsToDelete = photoPosts.flatMap((p) =>
      (p.mediaUrls?.length ?? 0) > 0 ? p.mediaUrls : (p.mediaUrl ? [p.mediaUrl] : [])
    );
    Promise.allSettled(
      urlsToDelete.map((url) => deleteMedia(url).catch((e) => console.error('Cloudinary cleanup failed:', e)))
    );

    res.json({ message: 'User deleted' });
  } catch (err) {
    next(err);
  }
}

async function deleteGroup(req, res, next) {
  try {
    const group = await prisma.group.findUnique({ where: { id: req.params.groupId } });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Capture media URLs before deleting — cascade will remove post records
    const photoPosts = await prisma.post.findMany({
      where: { groupId: req.params.groupId, type: 'photo' },
      select: { mediaUrl: true, mediaUrls: true },
    });

    try {
      await prisma.group.delete({ where: { id: req.params.groupId } });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Group not found' });
      throw err;
    }

    // Best-effort Cloudinary cleanup after DB delete succeeds
    const urlsToDelete = photoPosts.flatMap((p) =>
      (p.mediaUrls?.length ?? 0) > 0 ? p.mediaUrls : (p.mediaUrl ? [p.mediaUrl] : [])
    );
    Promise.allSettled(
      urlsToDelete.map((url) => deleteMedia(url).catch((e) => console.error('Cloudinary cleanup failed:', e)))
    );

    res.json({ message: 'Group deleted' });
  } catch (err) {
    next(err);
  }
}

// ── Groups ───────────────────────────────────────────────────────────────────

async function listGroups(req, res, next) {
  try {
    const groups = await prisma.group.findMany({
      include: {
        _count: { select: { members: true } },
        members: {
          where: { user: { isActive: false } },
          select: { userId: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json(groups.map((g) => ({
      ...g,
      suspendedCount: g.members.length,
      members: undefined,
    })));
  } catch (err) {
    next(err);
  }
}

async function listGroupMembers(req, res, next) {
  try {
    const { groupId } = req.params;
    const { cursor, search } = req.query;
    const take = 30;

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const where = {
      groupId,
      ...(search
        ? {
            user: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const rows = await prisma.groupMember.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } },
      },
      orderBy: { joinedAt: 'asc' },
      take: take + 1,
      ...(cursor
        ? { cursor: { userId_groupId: { userId: cursor, groupId } }, skip: 1 }
        : {}),
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? page[page.length - 1].userId : null;

    res.json({
      members: page.map((m) => ({ ...m.user, joinedAt: m.joinedAt })),
      nextCursor,
    });
  } catch (err) {
    next(err);
  }
}

async function createGroup(req, res, next) {
  try {
    const { name, slug, description } = req.body;

    const existing = await prisma.group.findUnique({ where: { slug } });
    if (existing) {
      return res.status(409).json({ error: 'A group with this slug already exists' });
    }

    const group = await prisma.group.create({
      data: { name, slug, description },
    });

    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
}

async function addGroupMember(req, res, next) {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const membership = await prisma.groupMember.create({
      data: { userId, groupId },
    });

    res.status(201).json(membership);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'User is already a member of this group' });
    }
    next(err);
  }
}

async function removeGroupMember(req, res, next) {
  try {
    const { groupId, userId } = req.params;

    await prisma.groupMember.delete({
      where: { userId_groupId: { userId, groupId } },
    });

    res.json({ message: 'Member removed' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Membership not found' });
    }
    next(err);
  }
}

// ── Posts ─────────────────────────────────────────────────────────────────────

const PIN_LIMIT = 3;

async function togglePinPost(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (!post.isPinned) {
      const pinnedCount = await prisma.post.count({
        where: { groupId: post.groupId, isPinned: true },
      });
      if (pinnedCount >= PIN_LIMIT) {
        return res.status(400).json({ error: `This group already has ${PIN_LIMIT} pinned posts. Unpin one first.` });
      }
    }

    const updated = await prisma.post.update({
      where: { id: req.params.postId },
      data: {
        isPinned: !post.isPinned,
        pinnedAt: !post.isPinned ? new Date() : null,
      },
      select: { id: true, isPinned: true, pinnedAt: true },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

async function toggleDownrankPost(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const updated = await prisma.post.update({
      where: { id: req.params.postId },
      data: { isDownranked: !post.isDownranked },
      select: { id: true, isDownranked: true },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ── Moderation ───────────────────────────────────────────────────────────────

async function listFlags(req, res, next) {
  try {
    const cursor = req.query.cursor;

    const flags = await prisma.flag.findMany({
      where: { reviewedAt: null },
      include: {
        flaggedBy: { select: { id: true, firstName: true, lastName: true } },
        post: { select: { id: true, title: true } },
        comment: {
          select: {
            id: true,
            content: true,
            post: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: ADMIN_LIST_LIMIT,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const nextCursor = flags.length === ADMIN_LIST_LIMIT ? flags[flags.length - 1].id : null;

    res.json({ flags, nextCursor });
  } catch (err) {
    next(err);
  }
}

async function reviewFlag(req, res, next) {
  try {
    const flag = await prisma.flag.findUnique({ where: { id: req.params.flagId } });

    if (!flag) {
      return res.status(404).json({ error: 'Flag not found' });
    }

    const ops = [
      prisma.flag.update({
        where: { id: req.params.flagId },
        data: { reviewedById: req.user.userId, reviewedAt: new Date() },
      }),
    ];

    // Clear isFlagged on the flagged content
    if (flag.contentType === 'post' && flag.postId) {
      ops.push(
        prisma.post.update({ where: { id: flag.postId }, data: { isFlagged: false } })
      );
    } else if (flag.contentType === 'comment' && flag.commentId) {
      ops.push(
        prisma.comment.update({ where: { id: flag.commentId }, data: { isFlagged: false } })
      );
    }

    const [updated] = await prisma.$transaction(ops);

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ── Push broadcast ────────────────────────────────────────────────────────────

async function pushBroadcast(req, res, next) {
  try {
    const { title, body, url, image, target, groupIds, emails } = req.body;

    let subscriptions;

    if (target === 'all') {
      subscriptions = await prisma.pushSubscription.findMany();
    } else if (target === 'groups') {
      subscriptions = await prisma.pushSubscription.findMany({
        where: {
          user: {
            groupMemberships: { some: { groupId: { in: groupIds } } },
          },
        },
      });
    } else if (target === 'emails') {
      subscriptions = await prisma.pushSubscription.findMany({
        where: { user: { email: { in: emails } } },
      });
    } else {
      return res.status(400).json({ error: 'Invalid target' });
    }

    const payload = { title, body, ...(url && { url }), ...(image && { image }) };
    const expired = [];
    let sent = 0;

    await Promise.all(
      subscriptions.map(async (sub) => {
        const ok = await sendPush(sub, payload);
        if (ok) {
          sent++;
        } else {
          expired.push(sub.id);
        }
      })
    );

    if (expired.length > 0) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: expired } } });
    }

    res.json({ sent, failed: expired.length });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createUser, sendInvite, listUsers, suspendUser, deleteUser,
  listGroups, listGroupMembers, createGroup, deleteGroup, addGroupMember, removeGroupMember,
  togglePinPost, toggleDownrankPost,
  listFlags, reviewFlag,
  pushBroadcast,
};

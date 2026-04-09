const prisma = require('../prisma/client');

async function upsertReaction(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.userId, groupId: post.groupId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const reaction = await prisma.reaction.upsert({
      where: { postId_userId: { postId: post.id, userId: req.user.userId } },
      update: { type: req.body.type },
      create: { postId: post.id, userId: req.user.userId, type: req.body.type },
    });

    res.json(reaction);
  } catch (err) {
    next(err);
  }
}

async function removeReaction(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await prisma.reaction.delete({
      where: { postId_userId: { postId: post.id, userId: req.user.userId } },
    });

    res.json({ message: 'Reaction removed' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Reaction not found' });
    }
    next(err);
  }
}

async function getReactors(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.userId, groupId: post.groupId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const userSelect = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } };

    const [withYou, helpedMe, hug, counts] = await Promise.all([
      prisma.reaction.findMany({ where: { postId: post.id, type: 'with_you' }, include: { user: userSelect }, orderBy: { createdAt: 'asc' }, take: 20 }),
      prisma.reaction.findMany({ where: { postId: post.id, type: 'helped_me' }, include: { user: userSelect }, orderBy: { createdAt: 'asc' }, take: 20 }),
      prisma.reaction.findMany({ where: { postId: post.id, type: 'hug' }, include: { user: userSelect }, orderBy: { createdAt: 'asc' }, take: 20 }),
      prisma.reaction.groupBy({ by: ['type'], where: { postId: post.id }, _count: true }),
    ]);

    const totalFor = (type) => counts.find((c) => c.type === type)?._count ?? 0;

    res.json({
      with_you: { users: withYou.map((r) => r.user), total: totalFor('with_you') },
      helped_me: { users: helpedMe.map((r) => r.user), total: totalFor('helped_me') },
      hug: { users: hug.map((r) => r.user), total: totalFor('hug') },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { upsertReaction, removeReaction, getReactors };

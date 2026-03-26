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

module.exports = { upsertReaction, removeReaction };

const prisma = require('../prisma/client');

async function getComments(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Verify membership
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.userId, groupId: post.groupId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    // Fetch top-level comments with their replies nested
    const comments = await prisma.comment.findMany({
      where: { postId: req.params.postId, parentId: null },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        flags: { where: { flaggedById: req.user.userId }, select: { id: true } },
        replies: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
            flags: { where: { flaggedById: req.user.userId }, select: { id: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const result = comments.map(({ flags, replies, ...comment }) => ({
      ...comment,
      flaggedByMe: flags.length > 0,
      replies: replies.map(({ flags: replyFlags, ...reply }) => ({
        ...reply,
        flaggedByMe: replyFlags.length > 0,
      })),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function createComment(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Verify membership
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.userId, groupId: post.groupId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const { content, parentId } = req.body;

    // If replying, verify the parent comment exists and belongs to this post
    let parentComment = null;
    if (parentId) {
      parentComment = await prisma.comment.findUnique({ where: { id: parentId } });
      if (!parentComment || parentComment.postId !== post.id) {
        return res.status(404).json({ error: 'Parent comment not found' });
      }
      if (parentComment.parentId !== null) {
        return res.status(400).json({ error: 'Replies to replies are not allowed' });
      }
    }

    const comment = await prisma.comment.create({
      data: { postId: post.id, userId: req.user.userId, content, parentId: parentId || null },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    // Pass the already-fetched parentComment to avoid a redundant DB query
    await createNotification({ comment, post, actorId: req.user.userId, parentComment });

    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
}

async function createNotification({ comment, post, actorId, parentComment }) {
  let recipientId;
  let type;

  if (parentComment) {
    // Reply to a comment — notify the parent comment's author
    if (!parentComment.userId) return;
    recipientId = parentComment.userId;
    type = 'comment_reply';
  } else {
    // New comment on a post — notify the post author
    if (!post.userId) return;
    recipientId = post.userId;
    type = 'post_comment';
  }

  // Don't notify yourself
  if (recipientId === actorId) return;

  await prisma.notification.create({
    data: {
      recipientId,
      triggeredById: actorId,
      type,
      postId: post.id,
      commentId: comment.id,
    },
  });
}

async function updateComment(req, res, next) {
  try {
    const comment = await prisma.comment.findUnique({
      where: { id: req.params.commentId },
      include: { post: { select: { groupId: true } } },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.userId !== req.user.userId) {
      return res.status(403).json({ error: 'You can only edit your own comments' });
    }

    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.userId, groupId: comment.post.groupId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const updated = await prisma.comment.update({
      where: { id: req.params.commentId },
      data: { content: req.body.content },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

async function deleteComment(req, res, next) {
  try {
    const comment = await prisma.comment.findUnique({ where: { id: req.params.commentId } });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const isOwner = comment.userId === req.user.userId;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }

    await prisma.comment.delete({ where: { id: req.params.commentId } });

    res.json({ message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
}

async function flagComment(req, res, next) {
  try {
    const comment = await prisma.comment.findUnique({
      where: { id: req.params.commentId },
      include: { post: { select: { groupId: true } } },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Verify membership
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.userId, groupId: comment.post.groupId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    await prisma.$transaction([
      prisma.comment.update({ where: { id: comment.id }, data: { isFlagged: true } }),
      prisma.flag.create({
        data: {
          flaggedById: req.user.userId,
          contentType: 'comment',
          commentId: comment.id,
          reason: req.body.reason || null,
        },
      }),
    ]);

    res.json({ message: 'Comment flagged for review' });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'You have already flagged this comment' });
    }
    next(err);
  }
}

module.exports = { getComments, createComment, updateComment, deleteComment, flagComment };

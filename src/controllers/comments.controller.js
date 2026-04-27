const prisma = require('../prisma/client');
const { parseMentions, processMentions } = require('../services/mention.service');

const MENTION_TOKEN_RE = /@\[([^\]]+)\]\([^)]+\)/g;
function displayLen(s) {
  return s ? s.replace(MENTION_TOKEN_RE, '@$1').length : 0;
}

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

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment cannot be empty' });
    }
    if (displayLen(content) > 10000) {
      return res.status(400).json({ error: 'Comment cannot exceed 10,000 characters' });
    }

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

    res.status(201).json(comment);

    // Fire notifications + mentions as non-critical side effects.
    // Chain them so mention notifications skip users already notified via thread/reply/post paths.
    // Mentions take priority: users who are tagged skip thread/reply/post notifications
    // and receive a mention notification instead.
    const mentionedUserIds = parseMentions(content);
    createNotification({ comment, post, actorId: req.user.userId, parentComment, mentionedUserIds })
      .then(() => {
        if (mentionedUserIds.length > 0) {
          return processMentions({ actorId: req.user.userId, mentionedUserIds, post, comment });
        }
      })
      .catch((err) => console.error('Failed to create comment notification:', err));
  } catch (err) {
    next(err);
  }
}

async function createNotification({ comment, post, actorId, parentComment, mentionedUserIds = [] }) {
  // Mentioned users are reserved for the mention notification — exclude them here
  const notified = new Set([actorId, ...mentionedUserIds]);
  const toCreate = [];

  // 1. Direct reply — notify the parent comment's author
  if (parentComment?.userId && !notified.has(parentComment.userId)) {
    notified.add(parentComment.userId);
    toCreate.push({ recipientId: parentComment.userId, type: 'comment_reply' });
  }

  // 2. Always notify the post author about any new comment or reply
  if (post.userId && !notified.has(post.userId)) {
    notified.add(post.userId);
    toCreate.push({ recipientId: post.userId, type: 'post_comment' });
  }

  // 3. Notify thread participants:
  //    - For a reply: others who have replied to the same parent comment
  //    - For a top-level comment: others who have commented at the top level on this post
  const previousCommenters = await prisma.comment.findMany({
    where: {
      postId: post.id,
      parentId: parentComment ? parentComment.id : null,
      userId: { not: null },
    },
    select: { userId: true },
    distinct: ['userId'],
  });

  for (const { userId } of previousCommenters) {
    if (!notified.has(userId)) {
      notified.add(userId);
      toCreate.push({ recipientId: userId, type: 'thread_comment' });
    }
  }

  if (toCreate.length === 0) return;

  await prisma.notification.createMany({
    data: toCreate.map((n) => ({
      ...n,
      triggeredById: actorId,
      postId: post.id,
      commentId: comment.id,
    })),
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

    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment cannot be empty' });
    }
    if (displayLen(content) > 10000) {
      return res.status(400).json({ error: 'Comment cannot exceed 10,000 characters' });
    }

    const updated = await prisma.comment.update({
      where: { id: req.params.commentId },
      data: { content },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    res.json(updated);

    const mentionedUserIds = parseMentions(content);
    if (mentionedUserIds.length > 0) {
      prisma.mention
        .findMany({ where: { commentId: comment.id }, select: { mentionedUserId: true } })
        .then((existing) => {
          const previousUserIds = existing.map((m) => m.mentionedUserId);
          const post = { id: comment.postId, groupId: comment.post.groupId };
          return processMentions({ actorId: req.user.userId, mentionedUserIds, post, comment, previousUserIds });
        })
        .catch((err) => console.error('Failed to process comment mentions on update:', err));
    }
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

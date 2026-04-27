const { Prisma } = require('@prisma/client');
const prisma = require('../prisma/client');
const { uploadMedia, deleteMedia } = require('../services/upload.service');
const { fetchLinkPreview } = require('../services/linkPreview.service');
const { parseMentions, processMentions } = require('../services/mention.service');

// Internal helper — returns group IDs the given user belongs to
async function getUserGroupIds(userId) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  return memberships.map((m) => m.groupId);
}

// Flatten reactions array into per-type counts and myReaction
function flattenReactions(reactions, userId) {
  return {
    myReaction: reactions.find((r) => r.userId === userId)?.type || null,
    withYouCount: reactions.filter((r) => r.type === 'with_you').length,
    helpedMeCount: reactions.filter((r) => r.type === 'helped_me').length,
    hugCount: reactions.filter((r) => r.type === 'hug').length,
  };
}

const FEED_LIMIT = 20;

const POST_INCLUDE = (userId) => ({
  user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  group: { select: { id: true, name: true, slug: true } },
  reactions: { select: { type: true, userId: true } },
  flags: { where: { flaggedById: userId }, select: { id: true } },
  _count: { select: { comments: true, reactions: true } },
});

function formatPost({ reactions, flags, ...post }, userId) {
  return { ...post, ...flattenReactions(reactions, userId), flaggedByMe: flags.length > 0 };
}

async function getTopFeed(filterGroupIds, userId, page) {
  const offset = (page - 1) * FEED_LIMIT;

  // Fetch pinned posts for this group (only on page 1, ordered by pinnedAt desc)
  let pinnedPosts = [];
  if (page === 1) {
    const pinned = await prisma.post.findMany({
      where: { groupId: { in: filterGroupIds }, isPinned: true },
      include: POST_INCLUDE(userId),
      orderBy: { pinnedAt: 'desc' },
    });
    pinnedPosts = pinned.map((p) => formatPost(p, userId));
  }

  // Step 1: Get ranked post IDs, excluding pinned posts
  const ranked = await prisma.$queryRaw`
    SELECT p.id
    FROM "Post" p
    LEFT JOIN "Reaction" r ON r."postId" = p.id
    LEFT JOIN "Comment" c ON c."postId" = p.id
    WHERE p."groupId" IN (${Prisma.join(filterGroupIds)})
      AND p."isPinned" = false
    GROUP BY p.id
    ORDER BY
      p."isDownranked" ASC,
      (COUNT(DISTINCT r.id) + 2.0 * COUNT(DISTINCT c.id) + 5.0 / (EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 3600 + 1))::float / POWER(
        EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 3600 + 2, 1.8
      ) DESC
    LIMIT ${FEED_LIMIT} OFFSET ${offset}
  `;

  const rankedIds = ranked.map((r) => r.id);
  if (rankedIds.length === 0) return { pinnedPosts, posts: [] };

  // Step 2: Fetch full post data via Prisma (consistent shape with regular feed)
  const posts = await prisma.post.findMany({
    where: { id: { in: rankedIds } },
    include: POST_INCLUDE(userId),
  });

  // Step 3: Reorder posts to match ranked order and flatten reactions + flags
  const postMap = new Map(posts.map((p) => [p.id, p]));
  const rankedPosts = rankedIds.map((id) => formatPost(postMap.get(id), userId));

  return { pinnedPosts, posts: rankedPosts };
}

async function getFeed(req, res, next) {
  try {
    const groupIds = await getUserGroupIds(req.user.userId);

    if (groupIds.length === 0) {
      return res.json({ posts: [], nextCursor: null });
    }

    // If groupId query param is provided, verify membership and filter to that group
    let filterGroupIds = groupIds;
    if (req.query.groupId) {
      if (!groupIds.includes(req.query.groupId)) {
        return res.status(403).json({ error: 'You are not a member of this group' });
      }
      filterGroupIds = [req.query.groupId];
    }

    // Top feed — ranked by time-decayed reaction score, page-based pagination
    if (req.query.sort === 'top') {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const { pinnedPosts, posts } = await getTopFeed(filterGroupIds, req.user.userId, page);
      const hasMore = posts.length === FEED_LIMIT;
      return res.json({ pinnedPosts, posts, page, hasMore });
    }

    // Default feed — sorted by latest, cursor-based pagination
    const cursor = req.query.cursor;

    const posts = await prisma.post.findMany({
      where: { groupId: { in: filterGroupIds } },
      include: POST_INCLUDE(req.user.userId),
      orderBy: { createdAt: 'desc' },
      take: FEED_LIMIT,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const nextCursor = posts.length === FEED_LIMIT ? posts[posts.length - 1].id : null;

    res.json({ posts: posts.map((p) => formatPost(p, req.user.userId)), nextCursor });
  } catch (err) {
    next(err);
  }
}

async function getPost(req, res, next) {
  try {
    const post = await prisma.post.findUnique({
      where: { id: req.params.postId },
      include: POST_INCLUDE(req.user.userId),
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Verify the user is a member of the post's group
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.userId, groupId: post.groupId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    res.json(formatPost(post, req.user.userId));
  } catch (err) {
    next(err);
  }
}

const MENTION_TOKEN_RE = /@\[([^\]]+)\]\([^)]+\)/g;
function displayLen(s) {
  return s ? s.replace(MENTION_TOKEN_RE, '@$1').length : 0;
}

async function createPost(req, res, next) {
  try {
    const { groupId, type, title, content, linkUrl } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (title.length > 200) {
      return res.status(400).json({ error: 'Title cannot exceed 200 characters' });
    }
    if (content && displayLen(content) > 10000) {
      return res.status(400).json({ error: 'Content cannot exceed 10,000 characters' });
    }

    // Verify membership
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.userId, groupId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    let mediaUrl = null;
    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
      mediaUrls = await Promise.all(req.files.map((f) => uploadMedia(f.buffer, 'posts')));
      mediaUrl = mediaUrls[0];
    }

    let linkPreview = {};
    if (type === 'link' && linkUrl) {
      linkPreview = (await fetchLinkPreview(linkUrl)) ?? {};
    }

    const post = await prisma.post.create({
      data: {
        userId: req.user.userId,
        groupId,
        type,
        title,
        content: content || null,
        linkUrl: linkUrl || null,
        ...linkPreview,
        mediaUrl,
        mediaUrls,
      },
      include: POST_INCLUDE(req.user.userId),
    });

    res.status(201).json(formatPost(post, req.user.userId));

    const mentionedUserIds = parseMentions(title, content);
    if (mentionedUserIds.length > 0) {
      processMentions({ actorId: req.user.userId, mentionedUserIds, post }).catch((err) => {
        console.error('Failed to process post mentions:', err);
      });
    }
  } catch (err) {
    next(err);
  }
}

async function updatePost(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.userId !== req.user.userId) {
      return res.status(403).json({ error: 'You can only edit your own posts' });
    }

    if (!req.body.title || !req.body.title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (req.body.title.length > 200) {
      return res.status(400).json({ error: 'Title cannot exceed 200 characters' });
    }
    if (req.body.content && displayLen(req.body.content) > 10000) {
      return res.status(400).json({ error: 'Content cannot exceed 10,000 characters' });
    }

    const data = { title: req.body.title };
    if (req.body.content !== undefined) data.content = req.body.content || null;

    if (post.type === 'link' && req.body.linkUrl !== undefined) {
      data.linkUrl = req.body.linkUrl || null;
      if (data.linkUrl && data.linkUrl !== post.linkUrl) {
        const linkPreview = (await fetchLinkPreview(data.linkUrl)) ?? {};
        Object.assign(data, linkPreview);
      }
    }

    const updated = await prisma.post.update({
      where: { id: req.params.postId },
      data,
      include: POST_INCLUDE(req.user.userId),
    });

    res.json(formatPost(updated, req.user.userId));

    // Fire mention processing as a non-critical side effect
    const mentionedUserIds = parseMentions(req.body.title, req.body.content);
    if (mentionedUserIds.length > 0) {
      prisma.mention
        .findMany({ where: { postId: post.id, commentId: null }, select: { mentionedUserId: true } })
        .then((existing) => {
          const previousUserIds = existing.map((m) => m.mentionedUserId);
          return processMentions({ actorId: req.user.userId, mentionedUserIds, post: updated, previousUserIds });
        })
        .catch((err) => console.error('Failed to process post mentions on update:', err));
    }
  } catch (err) {
    next(err);
  }
}

async function deletePost(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const isOwner = post.userId === req.user.userId;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own posts' });
    }

    await prisma.post.delete({ where: { id: req.params.postId } });

    if (post.type === 'photo') {
      const urlsToDelete = (post.mediaUrls?.length ?? 0) > 0 ? post.mediaUrls : (post.mediaUrl ? [post.mediaUrl] : []);
      await Promise.all(
        urlsToDelete.map((url) =>
          deleteMedia(url).catch((err) => console.error('Failed to delete post image from Cloudinary:', err))
        )
      );
    }

    res.json({ message: 'Post deleted' });
  } catch (err) {
    next(err);
  }
}

async function flagPost(req, res, next) {
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

    await prisma.$transaction([
      prisma.post.update({ where: { id: post.id }, data: { isFlagged: true } }),
      prisma.flag.create({
        data: {
          flaggedById: req.user.userId,
          contentType: 'post',
          postId: post.id,
          reason: req.body.reason || null,
        },
      }),
    ]);

    res.json({ message: 'Post flagged for review' });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'You have already flagged this post' });
    }
    next(err);
  }
}

async function searchPosts(req, res, next) {
  try {
    const q = (req.query.q || '').trim()
    if (!q) return res.json({ posts: [] })

    const groupIds = await getUserGroupIds(req.user.userId)
    if (groupIds.length === 0) return res.json({ posts: [] })

    const posts = await prisma.post.findMany({
      where: {
        groupId: { in: groupIds },
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { content: { contains: q, mode: 'insensitive' } },
        ],
      },
      include: POST_INCLUDE(req.user.userId),
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    res.json({ posts: posts.map((p) => formatPost(p, req.user.userId)) })
  } catch (err) {
    next(err)
  }
}

module.exports = { getFeed, getPost, createPost, updatePost, deletePost, flagPost, searchPosts };

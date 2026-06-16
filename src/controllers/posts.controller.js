const { Prisma } = require('@prisma/client');
const prisma = require('../prisma/client');
const { uploadMedia, deleteMedia } = require('../services/upload.service');
const { fetchLinkPreview } = require('../services/linkPreview.service');
const { parseMentions, processMentions } = require('../services/mention.service');
const { getAccessibleGroup, canAccessGroup, getAccessibleGroupIds } = require('../lib/groupAccess');

// Fetches per-type reaction counts for a batch of posts in one query.
// Returns a map of postId → { withYouCount, helpedMeCount, hugCount }.
// Posts with no reactions are absent from the map; callers default to 0.
async function batchReactionCounts(postIds) {
  if (postIds.length === 0) return {};
  const rows = await prisma.$queryRaw`
    SELECT
      "postId",
      (COUNT(*) FILTER (WHERE type = 'with_you'))::int  AS "withYouCount",
      (COUNT(*) FILTER (WHERE type = 'helped_me'))::int AS "helpedMeCount",
      (COUNT(*) FILTER (WHERE type = 'hug'))::int        AS "hugCount"
    FROM "Reaction"
    WHERE "postId" IN (${Prisma.join(postIds)})
    GROUP BY "postId"
  `;
  return Object.fromEntries(rows.map((r) => [r.postId, r]));
}

const FEED_LIMIT = 20;
const MAX_TOP_FEED_PAGE = 500;

// reactions is filtered to the current user only (0 or 1 row per post).
// Per-type counts come from batchReactionCounts, not from this include.
const POST_INCLUDE = (userId) => ({
  user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  group: { select: { id: true, name: true, slug: true } },
  reactions: { where: { userId }, select: { type: true } },
  flags: { where: { flaggedById: userId }, select: { id: true } },
  bookmarks: { where: { userId }, select: { id: true } },
  _count: { select: { comments: true, reactions: true } },
});

// counts is the entry from batchReactionCounts for this post (may be undefined for posts with no reactions).
function formatPost({ reactions, flags, bookmarks, ...post }, counts) {
  return {
    ...post,
    myReaction: reactions[0]?.type ?? null,
    withYouCount: counts?.withYouCount ?? 0,
    helpedMeCount: counts?.helpedMeCount ?? 0,
    hugCount: counts?.hugCount ?? 0,
    flaggedByMe: flags.length > 0,
    isBookmarked: bookmarks.length > 0,
  };
}

async function getTopFeed(filterGroupIds, userId, page) {
  const offset = (page - 1) * FEED_LIMIT;

  // Pinned posts: Prisma query on page 1 only
  let pinnedPosts = [];
  if (page === 1) {
    const pinnedRaw = await prisma.post.findMany({
      where: { groupId: { in: filterGroupIds }, isPinned: true },
      include: POST_INCLUDE(userId),
      orderBy: { pinnedAt: 'desc' },
    });
    if (pinnedRaw.length > 0) {
      const pinnedCounts = await batchReactionCounts(pinnedRaw.map((p) => p.id));
      pinnedPosts = pinnedRaw.map((p) => formatPost(p, pinnedCounts[p.id]));
    }
  }

  // Ranked posts: single query that ranks, joins all related data, and aggregates
  // all counts in one round trip — replaces the previous rank → fetch → count chain.
  const rows = await prisma.$queryRaw`
    SELECT
      p.id,
      p."userId",
      p."groupId",
      p.type,
      p.title,
      p.content,
      p."linkUrl",
      p."linkPreviewImage",
      p."linkPreviewTitle",
      p."linkPreviewDescription",
      p."mediaUrl",
      array_to_json(p."mediaUrls") AS "mediaUrls",
      p."isFlagged",
      p."isPinned",
      p."pinnedAt",
      p."isDownranked",
      p."createdAt",
      p."updatedAt",
      CASE WHEN u.id IS NOT NULL
        THEN json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName", 'avatarUrl', u."avatarUrl")
        ELSE NULL
      END AS "user",
      json_build_object('id', g.id, 'name', g.name, 'slug', g.slug) AS "group",
      (SELECT r2.type FROM "Reaction" r2 WHERE r2."postId" = p.id AND r2."userId" = ${userId} LIMIT 1) AS "myReaction",
      (COUNT(DISTINCT c.id))::int                                                 AS "commentCount",
      (COUNT(DISTINCT r.id))::int                                                 AS "reactionCount",
      (COUNT(DISTINCT r.id) FILTER (WHERE r.type = 'with_you'))::int             AS "withYouCount",
      (COUNT(DISTINCT r.id) FILTER (WHERE r.type = 'helped_me'))::int            AS "helpedMeCount",
      (COUNT(DISTINCT r.id) FILTER (WHERE r.type = 'hug'))::int                  AS "hugCount",
      EXISTS(SELECT 1 FROM "Flag"     f WHERE f."postId" = p.id AND f."flaggedById" = ${userId}) AS "flaggedByMe",
      EXISTS(SELECT 1 FROM "Bookmark" b WHERE b."postId" = p.id AND b."userId"      = ${userId}) AS "isBookmarked"
    FROM "Post" p
    LEFT JOIN "User"     u ON u.id = p."userId"
    LEFT JOIN "Group"    g ON g.id = p."groupId"
    LEFT JOIN "Reaction" r ON r."postId" = p.id
    LEFT JOIN "Comment"  c ON c."postId" = p.id
    WHERE p."groupId" IN (${Prisma.join(filterGroupIds)})
      AND p."isPinned" = false
    GROUP BY p.id, u.id, g.id
    ORDER BY
      p."isDownranked" ASC,
      (COUNT(DISTINCT r.id) + 2.0 * COUNT(DISTINCT c.id) + 5.0 / (EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 3600 + 1)) / POWER(
        EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 3600 + 2, 1.8
      ) DESC
    LIMIT ${FEED_LIMIT} OFFSET ${offset}
  `;

  const posts = rows.map(({ commentCount, reactionCount, ...row }) => ({
    ...row,
    _count: { comments: commentCount, reactions: reactionCount },
  }));

  return { pinnedPosts, posts };
}

async function getFeed(req, res, next) {
  try {
    const groupIds = await getAccessibleGroupIds(req.user.userId);

    if (groupIds.length === 0) {
      return res.json({ posts: [], nextCursor: null });
    }

    // If groupId query param is provided, verify access and filter to that group
    let filterGroupIds = groupIds;
    if (req.query.groupId) {
      if (!groupIds.includes(req.query.groupId)) {
        return res.status(403).json({ error: 'You do not have access to this group' });
      }
      filterGroupIds = [req.query.groupId];
    }

    // Top feed — ranked by time-decayed reaction score, page-based pagination
    if (req.query.sort === 'top') {
      // Cap page to bound the OFFSET into the ranking scan/sort. 500 * 20 = 10k
      // posts deep, far past any real scrolling session; prevents large-offset
      // resource exhaustion on this unindexable, scored-live query. (#6)
      const page = Math.min(MAX_TOP_FEED_PAGE, Math.max(1, parseInt(req.query.page) || 1));
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

    const counts = await batchReactionCounts(posts.map((p) => p.id));
    const nextCursor = posts.length === FEED_LIMIT ? posts[posts.length - 1].id : null;

    res.json({ posts: posts.map((p) => formatPost(p, counts[p.id])), nextCursor });
  } catch (err) {
    // A well-formed but stale cursor (anchor row deleted between page loads)
    // makes Prisma throw P2025; degrade to an empty page instead of 500. (#11)
    if (err.code === 'P2025') return res.json({ posts: [], nextCursor: null });
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

    if (!(await canAccessGroup(req.user.userId, post.groupId))) {
      return res.status(403).json({ error: 'You do not have access to this group' });
    }

    const counts = await batchReactionCounts([post.id]);
    res.json(formatPost(post, counts[post.id]));
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

    const group = await getAccessibleGroup(req.user.userId, groupId);
    if (!group) {
      return res.status(403).json({ error: 'You do not have access to this group' });
    }
    if (group.hasChildren) {
      return res.status(400).json({ error: 'Posts cannot be created in a parent group' });
    }
    if (group.isViewOnly && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can post in this group' });
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

    // New post has no reactions yet — skip the batch query
    res.status(201).json(formatPost(post, {}));

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

    const [updated, counts] = await Promise.all([
      prisma.post.update({
        where: { id: req.params.postId },
        data,
        include: POST_INCLUDE(req.user.userId),
      }),
      batchReactionCounts([req.params.postId]),
    ]);

    res.json(formatPost(updated, counts[req.params.postId]));

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

    if (!(await canAccessGroup(req.user.userId, post.groupId))) {
      return res.status(403).json({ error: 'You do not have access to this group' });
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
    if (q.length > 200) return res.status(400).json({ error: 'Search query too long' })

    const groupIds = await getAccessibleGroupIds(req.user.userId)
    if (groupIds.length === 0) return res.json({ posts: [] })

    const isAuthorSearch = q.startsWith('@')
    const term = isAuthorSearch ? q.slice(1).trim() : q

    if (!term) return res.json({ posts: [], nextCursor: null })

    const cursor = req.query.cursor

    const where = isAuthorSearch
      ? {
          groupId: { in: groupIds },
          user: {
            OR: [
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
            ],
          },
        }
      : {
          groupId: { in: groupIds },
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { content: { contains: term, mode: 'insensitive' } },
          ],
        }

    const posts = await prisma.post.findMany({
      where,
      include: POST_INCLUDE(req.user.userId),
      orderBy: { createdAt: 'desc' },
      take: FEED_LIMIT,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    })

    const counts = await batchReactionCounts(posts.map((p) => p.id))
    const nextCursor = posts.length === FEED_LIMIT ? posts[posts.length - 1].id : null
    res.json({ posts: posts.map((p) => formatPost(p, counts[p.id])), nextCursor })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getFeed, getPost, createPost, updatePost, deletePost, flagPost, searchPosts,
  POST_INCLUDE, formatPost, batchReactionCounts,
};

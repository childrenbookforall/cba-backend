const prisma = require('../prisma/client');
const { canAccessGroup, getAccessibleGroupIds } = require('../lib/groupAccess');
const { POST_INCLUDE, formatPost, batchReactionCounts } = require('./posts.controller');

const BOOKMARK_LIMIT = 20;

async function addBookmark(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (!(await canAccessGroup(req.user.userId, post.groupId))) {
      return res.status(403).json({ error: 'You do not have access to this group' });
    }

    await prisma.bookmark.upsert({
      where: { postId_userId: { postId: post.id, userId: req.user.userId } },
      update: {},
      create: { postId: post.id, userId: req.user.userId },
    });

    res.json({ isBookmarked: true });
  } catch (err) {
    next(err);
  }
}

async function removeBookmark(req, res, next) {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (!(await canAccessGroup(req.user.userId, post.groupId))) {
      return res.status(403).json({ error: 'You do not have access to this group' });
    }

    await prisma.bookmark.delete({
      where: { postId_userId: { postId: post.id, userId: req.user.userId } },
    });

    res.json({ isBookmarked: false });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Bookmark not found' });
    }
    next(err);
  }
}

async function getSavedPosts(req, res, next) {
  try {
    const cursor = req.query.cursor;
    const q = (req.query.q || '').trim();
    if (q.length > 200) return res.status(400).json({ error: 'Search query too long' });

    // Only surface bookmarks in groups the user can still access. A bookmark made
    // before the user was removed from a group must not keep returning that post's
    // (possibly since-edited) content. See securityFindings.md #5.
    const groupIds = await getAccessibleGroupIds(req.user.userId);
    if (groupIds.length === 0) {
      return res.json({ posts: [], nextCursor: null, hasMore: false });
    }

    const searchFilter = q
      ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { content: { contains: q, mode: 'insensitive' } }] }
      : undefined;
    const postFilter = { groupId: { in: groupIds }, ...searchFilter };

    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: req.user.userId, post: postFilter },
      include: { post: { include: POST_INCLUDE(req.user.userId) } },
      orderBy: { createdAt: 'desc' },
      take: BOOKMARK_LIMIT,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const nextCursor = bookmarks.length === BOOKMARK_LIMIT ? bookmarks[bookmarks.length - 1].id : null;

    const rawPosts = bookmarks.map((b) => b.post);
    const counts = await batchReactionCounts(rawPosts.map((p) => p.id));
    const posts = rawPosts.map((p) => formatPost(p, counts[p.id]));

    res.json({ posts, nextCursor, hasMore: nextCursor !== null });
  } catch (err) {
    next(err);
  }
}

module.exports = { addBookmark, removeBookmark, getSavedPosts };

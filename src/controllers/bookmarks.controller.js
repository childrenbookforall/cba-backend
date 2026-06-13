const prisma = require('../prisma/client');
const { canAccessGroup, getAccessibleGroupIds } = require('../lib/groupAccess');

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
      include: {
        post: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
            group: { select: { id: true, name: true, slug: true } },
            reactions: { select: { type: true, userId: true } },
            flags: { where: { flaggedById: req.user.userId }, select: { id: true } },
            bookmarks: { where: { userId: req.user.userId }, select: { id: true } },
            _count: { select: { comments: true, reactions: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: BOOKMARK_LIMIT,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const nextCursor = bookmarks.length === BOOKMARK_LIMIT ? bookmarks[bookmarks.length - 1].id : null;

    const posts = bookmarks.map(({ post }) => {
      const { reactions, flags, bookmarks: bm, ...rest } = post;
      const myReaction = reactions.find((r) => r.userId === req.user.userId)?.type || null;
      return {
        ...rest,
        myReaction,
        withYouCount: reactions.filter((r) => r.type === 'with_you').length,
        helpedMeCount: reactions.filter((r) => r.type === 'helped_me').length,
        hugCount: reactions.filter((r) => r.type === 'hug').length,
        flaggedByMe: flags.length > 0,
        isBookmarked: bm.length > 0,
      };
    });

    res.json({ posts, nextCursor, hasMore: nextCursor !== null });
  } catch (err) {
    next(err);
  }
}

module.exports = { addBookmark, removeBookmark, getSavedPosts };

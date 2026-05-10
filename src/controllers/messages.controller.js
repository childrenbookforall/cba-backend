const prisma = require('../prisma/client');
const { canonicalPair } = require('../lib/messages');

const PAGE_SIZE = 30;

function formatOtherUser(user) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName ?? null,
    avatarUrl: user.avatarUrl ?? null,
  };
}

async function getConversations(req, res, next) {
  try {
    const me = req.user.userId;

    const conversations = await prisma.conversation.findMany({
      where: { OR: [{ userAId: me }, { userBId: me }] },
      orderBy: { updatedAt: 'desc' },
      include: {
        userA: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        userB: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, content: true, senderId: true, createdAt: true } },
      },
    });

    const convIds = conversations.map((c) => c.id);

    const unreadGroups = await prisma.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: convIds }, senderId: { not: me }, isRead: false },
      _count: { id: true },
    });

    const unreadMap = new Map(unreadGroups.map((g) => [g.conversationId, g._count.id]));

    const results = conversations.map((conv) => ({
      id: conv.id,
      otherUser: formatOtherUser(conv.userAId === me ? conv.userB : conv.userA),
      lastMessage: conv.messages[0] ?? null,
      unreadCount: unreadMap.get(conv.id) ?? 0,
      updatedAt: conv.updatedAt,
    }));

    res.json(results);
  } catch (err) {
    next(err);
  }
}

async function getConversation(req, res, next) {
  try {
    const me = req.user.userId;
    const them = req.params.userId;

    const other = await prisma.user.findUnique({
      where: { id: them },
      select: { id: true, isActive: true, firstName: true, lastName: true, avatarUrl: true },
    });
    if (!other) return res.status(404).json({ error: 'User not found' });

    const pair = canonicalPair(me, them);
    const conversation = await prisma.conversation.findUnique({
      where: { userAId_userBId: pair },
    });

    if (!conversation) {
      return res.json({ conversation: null, messages: [], hasMore: false, nextCursor: null });
    }

    const cursor = req.query.cursor;

    await prisma.message.updateMany({
      where: { conversationId: conversation.id, senderId: them, isRead: false },
      data: { isRead: true },
    });

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = messages.length > PAGE_SIZE;
    if (hasMore) messages.pop();

    res.json({
      conversation: {
        id: conversation.id,
        otherUser: formatOtherUser(other),
        updatedAt: conversation.updatedAt,
      },
      messages,
      hasMore,
      nextCursor: hasMore ? messages[messages.length - 1].id : null,
    });
  } catch (err) {
    next(err);
  }
}

async function sendMessage(req, res, next) {
  try {
    const me = req.user.userId;
    const them = req.params.userId;
    const { content } = req.body;

    if (me === them) return res.status(400).json({ error: 'Cannot message yourself' });

    const recipient = await prisma.user.findUnique({
      where: { id: them },
      select: { id: true, isActive: true, email: true, firstName: true, lastName: true },
    });
    if (!recipient) return res.status(404).json({ error: 'User not found' });
    if (!recipient.isActive) return res.status(403).json({ error: 'Cannot send messages to this user' });

    const pair = canonicalPair(me, them);
    const existingConv = await prisma.conversation.findUnique({
      where: { userAId_userBId: pair },
    });

    if (!existingConv) {
      const sender = await prisma.user.findUnique({
        where: { id: me },
        select: { role: true, canInitiateMessages: true, _count: { select: { posts: true, comments: true } } },
      });

      if (!sender) return res.status(401).json({ error: 'User not found' });

      if (sender.role !== 'admin' && !sender.canInitiateMessages) {
        const reactionCount = await prisma.reaction.count({
          where: { post: { userId: me } },
        });
        const eligible =
          sender._count.posts >= 3 &&
          sender._count.comments >= 5 &&
          reactionCount >= 10;

        if (!eligible) {
          return res.status(403).json({ error: 'Create more posts and comments to enable this feature' });
        }

        // Atomically grant the flag — prevents two concurrent requests both passing
        // the eligibility read and both trying to create a first conversation
        const { count } = await prisma.user.updateMany({
          where: { id: me, canInitiateMessages: false },
          data: { canInitiateMessages: true },
        });
        if (count === 0) {
          // Another concurrent request already granted it — that's fine, proceed
        }
      }
    }

    const conversation = await prisma.conversation.upsert({
      where: { userAId_userBId: pair },
      create: { ...pair },
      update: { updatedAt: new Date() },
    });

    const message = await prisma.message.create({
      data: { conversationId: conversation.id, senderId: me, content },
    });

    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
}


async function markRead(req, res, next) {
  try {
    const me = req.user.userId;
    const them = req.params.userId;

    const pair = canonicalPair(me, them);
    const conversation = await prisma.conversation.findUnique({
      where: { userAId_userBId: pair },
    });

    if (conversation) {
      await prisma.message.updateMany({
        where: { conversationId: conversation.id, senderId: them, isRead: false },
        data: { isRead: true },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { getConversations, getConversation, sendMessage, markRead };

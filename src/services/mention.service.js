const prisma = require('../prisma/client');
const { sendPush } = require('./push.service');

// Matches @[Display Name](uuid)
const MENTION_REGEX = /@\[([^\]]+)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
const MAX_MENTIONS = 10;

function parseMentions(...texts) {
  const ids = new Set();
  for (const text of texts) {
    if (!text) continue;
    for (const [, , userId] of text.matchAll(MENTION_REGEX)) {
      ids.add(userId);
      if (ids.size >= MAX_MENTIONS) return [...ids];
    }
  }
  return [...ids];
}

// Upserts Mention records and fires mention notifications for newly tagged users.
// Pass previousUserIds (IDs mentioned before an edit) to skip re-notifying.
async function processMentions({ actorId, mentionedUserIds, post, comment = null, previousUserIds = [] }) {
  if (mentionedUserIds.length === 0) return;

  const commentId = comment?.id ?? null;

  // Only process mentions for users who are actually members of the post's group.
  // Prevents notifications pointing to content the recipient can't access.
  let eligibleIds = mentionedUserIds;
  if (post.groupId) {
    const members = await prisma.groupMember.findMany({
      where: { groupId: post.groupId, userId: { in: mentionedUserIds } },
      select: { userId: true },
    });
    const memberSet = new Set(members.map((m) => m.userId));
    eligibleIds = mentionedUserIds.filter((id) => memberSet.has(id));
  }

  if (eligibleIds.length === 0) return;

  await Promise.all(
    eligibleIds.map((userId) =>
      prisma.mention.upsert({
        where: commentId
          ? { mentionedUserId_commentId: { mentionedUserId: userId, commentId } }
          : { mentionedUserId_postId: { mentionedUserId: userId, postId: post.id } },
        create: { mentionedUserId: userId, postId: commentId ? null : post.id, commentId },
        update: {},
      })
    )
  );

  const newIds = eligibleIds.filter((id) => !previousUserIds.includes(id) && id !== actorId);
  if (newIds.length === 0) return;

  const validUsers = await prisma.user.findMany({
    where: { id: { in: newIds }, isActive: true },
    select: { id: true },
  });
  if (validUsers.length === 0) return;

  await prisma.notification.createMany({
    data: validUsers.map(({ id: recipientId }) => ({
      recipientId,
      triggeredById: actorId,
      type: 'mention',
      postId: post.id,
      commentId,
    })),
    skipDuplicates: true,
  });

  sendMentionPushes({ actorId, recipientIds: validUsers.map((u) => u.id), postId: post.id, postTitle: post.title })
    .catch((err) => console.error('Failed to send mention push notifications:', err));
}

async function sendMentionPushes({ actorId, recipientIds, postId, postTitle }) {
  const [actor, subscriptions] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true } }),
    prisma.pushSubscription.findMany({ where: { userId: { in: recipientIds } } }),
  ]);

  if (subscriptions.length === 0) return;

  const actorName = actor
    ? `${actor.firstName}${actor.lastName ? ` ${actor.lastName}` : ''}`
    : 'Someone';

  const payload = {
    title: `${actorName} mentioned you`,
    body: postTitle ?? 'Tap to view',
    url: `/posts/${postId}`,
  };

  const expired = [];
  await Promise.all(
    subscriptions.map(async (sub) => {
      const ok = await sendPush(sub, payload);
      if (!ok) expired.push(sub.id);
    })
  );

  if (expired.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: expired } } });
  }
}

module.exports = { parseMentions, processMentions };

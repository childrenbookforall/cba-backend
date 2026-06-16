const { AsyncLocalStorage } = require('node:async_hooks');
const prisma = require('../prisma/client');

// Per-request cache: initialized by initGroupAccessCache middleware.
// Stores getAccessibleGroup results for the duration of one HTTP request so
// repeated calls with the same (userId, groupId) hit the DB only once.
const requestStore = new AsyncLocalStorage();

function initGroupAccessCache(req, res, next) {
  requestStore.run(new Map(), next);
}

// Returns access-relevant group fields if the user can access the group
// (member or public), otherwise null. Also null if the group doesn't exist.
async function getAccessibleGroup(userId, groupId) {
  const cache = requestStore.getStore();
  const key = `${userId}:${groupId}`;

  if (cache?.has(key)) return cache.get(key);

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      isPublic: true,
      isViewOnly: true,
      parentId: true,
      members: { where: { userId }, select: { userId: true } },
      children: { select: { id: true }, take: 1 },
    },
  });

  let result = null;
  if (group && (group.isPublic || group.members.length > 0)) {
    const { members, children, ...rest } = group;
    result = { ...rest, hasChildren: children.length > 0 };
  }

  cache?.set(key, result);
  return result;
}

async function canAccessGroup(userId, groupId) {
  return (await getAccessibleGroup(userId, groupId)) !== null;
}

// Group IDs whose posts the user can see: memberships plus all public groups
async function getAccessibleGroupIds(userId) {
  const [memberships, publicGroups] = await Promise.all([
    prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } }),
    prisma.group.findMany({ where: { isPublic: true }, select: { id: true } }),
  ]);
  return [...new Set([...memberships.map((m) => m.groupId), ...publicGroups.map((g) => g.id)])];
}

module.exports = { getAccessibleGroup, canAccessGroup, getAccessibleGroupIds, initGroupAccessCache };

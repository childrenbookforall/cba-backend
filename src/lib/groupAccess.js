const prisma = require('../prisma/client');

// Returns access-relevant group fields if the user can access the group
// (member or public), otherwise null. Also null if the group doesn't exist.
async function getAccessibleGroup(userId, groupId) {
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
  if (!group) return null;
  if (!group.isPublic && group.members.length === 0) return null;
  const { members, children, ...rest } = group;
  return { ...rest, hasChildren: children.length > 0 };
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

module.exports = { getAccessibleGroup, canAccessGroup, getAccessibleGroupIds };

const prisma = require('../prisma/client');

async function listMyGroups(req, res, next) {
  try {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user.userId },
      include: {
        group: {
          select: { id: true, name: true, slug: true, description: true },
        },
      },
    });

    const groupIds = memberships.map((m) => m.group.id);

    // Count only members who have accepted their invite (passwordHash !== 'INVITE_PENDING')
    const memberCounts = await prisma.groupMember.findMany({
      where: {
        groupId: { in: groupIds },
        user: { passwordHash: { not: 'INVITE_PENDING' } },
      },
      select: { groupId: true },
    });

    const countByGroup = memberCounts.reduce((acc, { groupId }) => {
      acc[groupId] = (acc[groupId] ?? 0) + 1;
      return acc;
    }, {});

    const groups = memberships.map((m) => ({
      ...m.group,
      _count: { members: countByGroup[m.group.id] ?? 0 },
    }));

    res.json(groups);
  } catch (err) {
    next(err);
  }
}

async function getGroup(req, res, next) {
  try {
    const membership = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: { userId: req.user.userId, groupId: req.params.groupId },
      },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const group = await prisma.group.findUnique({
      where: { id: req.params.groupId },
      select: { id: true, name: true, slug: true, description: true },
    });

    res.json(group);
  } catch (err) {
    next(err);
  }
}

module.exports = { listMyGroups, getGroup };

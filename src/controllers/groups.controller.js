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
        user: { passwordHash: { not: 'INVITE_PENDING' }, role: 'member' },
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

async function listGroupMembers(req, res, next) {
  try {
    const { groupId } = req.params;
    const { cursor, search } = req.query;
    const take = 30;

    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.userId, groupId } },
    });
    if (!membership) return res.status(403).json({ error: 'You are not a member of this group' });

    const where = {
      groupId,
      user: {
        AND: [
          { passwordHash: { not: 'INVITE_PENDING' } },
          { role: 'member' },
          ...(search ? [{ OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ]}] : []),
        ],
      },
    };

    const rows = await prisma.groupMember.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true, isActive: true } },
      },
      orderBy: { joinedAt: 'asc' },
      take: take + 1,
      ...(cursor ? { cursor: { userId_groupId: { userId: cursor, groupId } }, skip: 1 } : {}),
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? page[page.length - 1].userId : null;

    res.json({
      members: page.map((m) => ({ ...m.user, joinedAt: m.joinedAt })),
      nextCursor,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listMyGroups, getGroup, listGroupMembers };

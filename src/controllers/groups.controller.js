const prisma = require('../prisma/client');
const { canAccessGroup } = require('../lib/groupAccess');

const GROUP_SELECT = { id: true, name: true, slug: true, description: true, parentId: true, isPublic: true, isViewOnly: true };

// Returns the groups the user can access, with children nested under parents.
// A leaf group (no children) is included if the user is a member or it is public;
// a parent group is included only when at least one of its children is.
async function listMyGroups(req, res, next) {
  try {
    const [memberships, allGroups] = await Promise.all([
      prisma.groupMember.findMany({
        where: { userId: req.user.userId },
        select: { groupId: true },
      }),
      prisma.group.findMany({ select: GROUP_SELECT, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
    ]);

    const memberGroupIds = new Set(memberships.map((m) => m.groupId));
    const parentIds = new Set(allGroups.filter((g) => g.parentId).map((g) => g.parentId));

    const visibleLeaves = allGroups.filter(
      (g) => !parentIds.has(g.id) && (g.isPublic || memberGroupIds.has(g.id))
    );

    // Count only members who have accepted their invite (passwordHash !== 'INVITE_PENDING')
    const memberCounts = await prisma.groupMember.findMany({
      where: {
        groupId: { in: visibleLeaves.map((g) => g.id) },
        user: { passwordHash: { not: 'INVITE_PENDING' }, role: 'member' },
      },
      select: { groupId: true },
    });

    const countByGroup = memberCounts.reduce((acc, { groupId }) => {
      acc[groupId] = (acc[groupId] ?? 0) + 1;
      return acc;
    }, {});

    const withCount = (g) => ({ ...g, _count: { members: countByGroup[g.id] ?? 0 } });

    const result = [];
    for (const g of allGroups) {
      if (parentIds.has(g.id)) {
        const children = visibleLeaves.filter((c) => c.parentId === g.id).map(withCount);
        if (children.length > 0) result.push({ ...g, children });
      } else if (!g.parentId && (g.isPublic || memberGroupIds.has(g.id))) {
        result.push(withCount(g));
      }
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getGroup(req, res, next) {
  try {
    if (!(await canAccessGroup(req.user.userId, req.params.groupId))) {
      return res.status(403).json({ error: 'You do not have access to this group' });
    }

    const group = await prisma.group.findUnique({
      where: { id: req.params.groupId },
      select: GROUP_SELECT,
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

    if (search && search.length > 200) return res.status(400).json({ error: 'Search query too long' });

    if (!(await canAccessGroup(req.user.userId, groupId))) {
      return res.status(403).json({ error: 'You do not have access to this group' });
    }

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

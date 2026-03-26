const {
  request, app, prisma,
  createUser, createAdmin, createGroup, addMember, createPost, createComment,
  deleteUser, deleteGroup, deletePost,
  signToken, authHeader,
} = require('./helpers');

describe('Admin API', () => {
  let admin, member;
  let adminToken, memberToken;

  beforeAll(async () => {
    [admin, member] = await Promise.all([createAdmin(), createUser()]);
    adminToken = signToken({ userId: admin.id, role: admin.role });
    memberToken = signToken({ userId: member.id, role: member.role });
  });

  afterAll(async () => {
    await Promise.all([deleteUser(admin.id), deleteUser(member.id)]);
  });

  // ─── USER MANAGEMENT ────────────────────────────────────────────────────────

  describe('POST /api/admin/users', () => {
    const createdIds = [];

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    });

    test('201 and new user object when admin creates a user', async () => {
      const email = `new-${Date.now()}@test.com`;
      const res = await request(app)
        .post('/api/admin/users')
        .set(authHeader(adminToken))
        .send({ firstName: 'New', lastName: 'User', email });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ firstName: 'New', lastName: 'User', email });
      expect(res.body).not.toHaveProperty('passwordHash');
      createdIds.push(res.body.id);
    });

    test('409 when email already exists', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set(authHeader(adminToken))
        .send({ firstName: 'Dup', lastName: 'User', email: member.email });
      expect(res.status).toBe(409);
    });

    test('400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set(authHeader(adminToken))
        .send({ firstName: 'Only' });
      expect(res.status).toBe(400);
    });

    test('400 for invalid email format', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set(authHeader(adminToken))
        .send({ firstName: 'Bad', lastName: 'Email', email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    test('403 when a regular member tries to create a user', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .set(authHeader(memberToken))
        .send({ firstName: 'Hack', lastName: 'Attempt', email: 'hack@test.com' });
      expect(res.status).toBe(403);
    });

    test('401 without auth token', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .send({ firstName: 'No', lastName: 'Auth', email: 'noauth@test.com' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/users', () => {
    test('200 and paginated list of users', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('users');
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body).toHaveProperty('nextCursor');
    });

    test('each user has expected shape without passwordHash', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
      const u = res.body.users[0];
      expect(u).toHaveProperty('id');
      expect(u).toHaveProperty('email');
      expect(u).toHaveProperty('role');
      expect(u).toHaveProperty('isActive');
      expect(u).not.toHaveProperty('passwordHash');
    });

    test('cursor pagination works', async () => {
      const first = await request(app)
        .get('/api/admin/users')
        .set(authHeader(adminToken));
      if (first.body.nextCursor) {
        const second = await request(app)
          .get(`/api/admin/users?cursor=${first.body.nextCursor}`)
          .set(authHeader(adminToken));
        expect(second.status).toBe(200);
        const firstIds = first.body.users.map((u) => u.id);
        second.body.users.forEach((u) => expect(firstIds).not.toContain(u.id));
      }
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set(authHeader(memberToken));
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/users/:userId/invite', () => {
    let pendingUser;

    beforeAll(async () => {
      pendingUser = await createUser({ passwordHash: 'INVITE_PENDING' });
    });

    afterAll(async () => {
      await prisma.inviteToken.deleteMany({ where: { email: pendingUser.email } });
      await deleteUser(pendingUser.id);
    });

    test('201 when admin sends invite to a pending user', async () => {
      if (!process.env.RESEND_API_KEY) {
        return console.warn('Skipping invite email test — Resend not configured');
      }
      const res = await request(app)
        .post(`/api/admin/users/${pendingUser.id}/invite`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/invite sent/i);
    });

    test('404 for a non-existent user', async () => {
      const res = await request(app)
        .post('/api/admin/users/00000000-0000-0000-0000-000000000000/invite')
        .set(authHeader(adminToken));
      expect(res.status).toBe(404);
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .post(`/api/admin/users/${pendingUser.id}/invite`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/admin/users/:userId/suspend', () => {
    let target;

    beforeAll(async () => {
      target = await createUser();
    });

    afterAll(async () => {
      await deleteUser(target.id);
    });

    test('200 and toggles isActive to false (suspends user)', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${target.id}/suspend`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
    });

    test('200 and toggles isActive back to true (unsuspends user)', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${target.id}/suspend`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(true);
    });

    test('400 when admin tries to suspend themselves', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${admin.id}/suspend`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(400);
    });

    test('404 for non-existent user', async () => {
      const res = await request(app)
        .patch('/api/admin/users/00000000-0000-0000-0000-000000000000/suspend')
        .set(authHeader(adminToken));
      expect(res.status).toBe(404);
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${target.id}/suspend`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/admin/users/:userId', () => {
    test('200 when admin deletes a user', async () => {
      const toDelete = await createUser();
      const res = await request(app)
        .delete(`/api/admin/users/${toDelete.id}`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deleted/i);
    });

    test('400 when admin tries to delete themselves', async () => {
      const res = await request(app)
        .delete(`/api/admin/users/${admin.id}`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(400);
    });

    test('404 for a non-existent user', async () => {
      const res = await request(app)
        .delete('/api/admin/users/00000000-0000-0000-0000-000000000000')
        .set(authHeader(adminToken));
      expect(res.status).toBe(404);
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .delete(`/api/admin/users/${member.id}`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(403);
    });
  });

  // ─── GROUP MANAGEMENT ────────────────────────────────────────────────────────

  describe('GET /api/admin/groups', () => {
    let group;

    beforeAll(async () => {
      group = await createGroup({ name: 'Admin Group Test' });
    });

    afterAll(async () => {
      await deleteGroup(group.id);
    });

    test('200 and list of all groups with member count', async () => {
      const res = await request(app)
        .get('/api/admin/groups')
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const g = res.body.find((x) => x.id === group.id);
      expect(g).toBeDefined();
      expect(g._count).toHaveProperty('members');
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .get('/api/admin/groups')
        .set(authHeader(memberToken));
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/groups', () => {
    const createdIds = [];

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: createdIds } } });
    });

    test('201 and new group when admin creates one', async () => {
      const res = await request(app)
        .post('/api/admin/groups')
        .set(authHeader(adminToken))
        .send({ name: 'New Group', slug: 'new-group-test' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'New Group', slug: 'new-group-test' });
      createdIds.push(res.body.id);
    });

    test('409 when slug already exists', async () => {
      const res = await request(app)
        .post('/api/admin/groups')
        .set(authHeader(adminToken))
        .send({ name: 'Duplicate Slug', slug: 'new-group-test' });
      expect(res.status).toBe(409);
    });

    test('400 when slug contains invalid characters', async () => {
      const res = await request(app)
        .post('/api/admin/groups')
        .set(authHeader(adminToken))
        .send({ name: 'Bad Slug', slug: 'Bad Slug With Spaces' });
      expect(res.status).toBe(400);
    });

    test('400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/admin/groups')
        .set(authHeader(adminToken))
        .send({ slug: 'valid-slug' });
      expect(res.status).toBe(400);
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .post('/api/admin/groups')
        .set(authHeader(memberToken))
        .send({ name: 'Hack Group', slug: 'hack-group' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/groups/:groupId/members', () => {
    let group;

    beforeAll(async () => {
      group = await createGroup();
      await addMember(member.id, group.id);
    });

    afterAll(async () => {
      await deleteGroup(group.id);
    });

    test('200 and list of members for a group', async () => {
      const res = await request(app)
        .get(`/api/admin/groups/${group.id}/members`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const m = res.body.find((u) => u.id === member.id);
      expect(m).toBeDefined();
      expect(m).toHaveProperty('joinedAt');
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .get(`/api/admin/groups/${group.id}/members`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/groups/:groupId/members', () => {
    let group, target;

    beforeAll(async () => {
      group = await createGroup();
      target = await createUser();
    });

    afterAll(async () => {
      await deleteGroup(group.id);
      await deleteUser(target.id);
    });

    test('201 after adding a user to a group', async () => {
      const res = await request(app)
        .post(`/api/admin/groups/${group.id}/members`)
        .set(authHeader(adminToken))
        .send({ userId: target.id });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ userId: target.id, groupId: group.id });
    });

    test('409 when user is already a member', async () => {
      const res = await request(app)
        .post(`/api/admin/groups/${group.id}/members`)
        .set(authHeader(adminToken))
        .send({ userId: target.id });
      expect(res.status).toBe(409);
    });

    test('400 when userId is missing', async () => {
      const res = await request(app)
        .post(`/api/admin/groups/${group.id}/members`)
        .set(authHeader(adminToken))
        .send({});
      expect(res.status).toBe(400);
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .post(`/api/admin/groups/${group.id}/members`)
        .set(authHeader(memberToken))
        .send({ userId: target.id });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/admin/groups/:groupId/members/:userId', () => {
    let group, target;

    beforeEach(async () => {
      group = await createGroup();
      target = await createUser();
      await addMember(target.id, group.id);
    });

    afterEach(async () => {
      await deleteGroup(group.id);
      await deleteUser(target.id);
    });

    test('200 after removing a member from a group', async () => {
      const res = await request(app)
        .delete(`/api/admin/groups/${group.id}/members/${target.id}`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/removed/i);
    });

    test('404 when membership does not exist', async () => {
      const nonMember = await createUser();
      const res = await request(app)
        .delete(`/api/admin/groups/${group.id}/members/${nonMember.id}`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(404);
      await deleteUser(nonMember.id);
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .delete(`/api/admin/groups/${group.id}/members/${target.id}`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(403);
    });
  });

  // ─── CONTENT MODERATION ──────────────────────────────────────────────────────

  describe('GET /api/admin/flags', () => {
    let group, post, flag;

    beforeAll(async () => {
      group = await createGroup();
      await addMember(member.id, group.id);
      post = await createPost(member.id, group.id, { title: 'Flagged Post' });
      flag = await prisma.flag.create({
        data: {
          flaggedById: member.id,
          contentType: 'post',
          postId: post.id,
          reason: 'Spam',
        },
      });
    });

    afterAll(async () => {
      await prisma.flag.deleteMany({ where: { id: flag.id } });
      await deletePost(post.id);
      await deleteGroup(group.id);
    });

    test('200 and list of unreviewed flags', async () => {
      const res = await request(app)
        .get('/api/admin/flags')
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('flags');
      expect(Array.isArray(res.body.flags)).toBe(true);
      const f = res.body.flags.find((x) => x.id === flag.id);
      expect(f).toBeDefined();
    });

    test('each flag includes flaggedBy, post/comment details', async () => {
      const res = await request(app)
        .get('/api/admin/flags')
        .set(authHeader(adminToken));
      const f = res.body.flags.find((x) => x.id === flag.id);
      if (f) {
        expect(f).toHaveProperty('flaggedBy');
        expect(f).toHaveProperty('post');
        expect(f.reviewedAt).toBeNull();
      }
    });

    test('response has nextCursor for pagination', async () => {
      const res = await request(app)
        .get('/api/admin/flags')
        .set(authHeader(adminToken));
      expect(res.body).toHaveProperty('nextCursor');
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .get('/api/admin/flags')
        .set(authHeader(memberToken));
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/admin/flags/:flagId/review', () => {
    let group, post, flag;

    beforeAll(async () => {
      group = await createGroup();
      await addMember(member.id, group.id);
      post = await createPost(member.id, group.id, { title: 'Review Flag Post' });
      flag = await prisma.flag.create({
        data: {
          flaggedById: member.id,
          contentType: 'post',
          postId: post.id,
        },
      });
    });

    afterAll(async () => {
      await prisma.flag.deleteMany({ where: { id: flag.id } });
      await deletePost(post.id);
      await deleteGroup(group.id);
    });

    test('200 and flag with reviewedAt and reviewedById set', async () => {
      const res = await request(app)
        .patch(`/api/admin/flags/${flag.id}/review`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.reviewedById).toBe(admin.id);
      expect(res.body.reviewedAt).not.toBeNull();
    });

    test('404 for a non-existent flag', async () => {
      const res = await request(app)
        .patch('/api/admin/flags/00000000-0000-0000-0000-000000000000/review')
        .set(authHeader(adminToken));
      expect(res.status).toBe(404);
    });

    test('403 for regular members', async () => {
      const res = await request(app)
        .patch(`/api/admin/flags/${flag.id}/review`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(403);
    });

    test('401 without auth token', async () => {
      const res = await request(app).patch(`/api/admin/flags/${flag.id}/review`);
      expect(res.status).toBe(401);
    });
  });
});

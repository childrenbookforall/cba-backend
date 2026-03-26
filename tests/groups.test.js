const {
  request, app,
  createUser, createGroup, addMember, deleteUser, deleteGroup,
  signToken, authHeader,
} = require('./helpers');

describe('Groups API', () => {
  let user, token;
  let groupA, groupB; // user is member of A but NOT B

  beforeAll(async () => {
    user = await createUser();
    token = signToken({ userId: user.id, role: user.role });
    groupA = await createGroup({ name: 'Alpha Group' });
    groupB = await createGroup({ name: 'Beta Group' });
    await addMember(user.id, groupA.id);
  });

  afterAll(async () => {
    await deleteGroup(groupA.id);
    await deleteGroup(groupB.id);
    await deleteUser(user.id);
  });

  // ─── GET /api/groups ────────────────────────────────────────────────────────

  describe('GET /api/groups', () => {
    test('200 and returns only groups the user belongs to', async () => {
      const res = await request(app)
        .get('/api/groups')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((g) => g.id);
      expect(ids).toContain(groupA.id);
      expect(ids).not.toContain(groupB.id);
    });

    test('each group has expected shape', async () => {
      const res = await request(app)
        .get('/api/groups')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      const group = res.body.find((g) => g.id === groupA.id);
      expect(group).toMatchObject({
        id: groupA.id,
        name: groupA.name,
        slug: groupA.slug,
      });
    });

    test('401 without auth token', async () => {
      const res = await request(app).get('/api/groups');
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /api/groups/:groupId ───────────────────────────────────────────────

  describe('GET /api/groups/:groupId', () => {
    test('200 and group details for a group the user is a member of', async () => {
      const res = await request(app)
        .get(`/api/groups/${groupA.id}`)
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: groupA.id,
        name: groupA.name,
        slug: groupA.slug,
      });
    });

    test('403 for a group the user is NOT a member of', async () => {
      const res = await request(app)
        .get(`/api/groups/${groupB.id}`)
        .set(authHeader(token));
      expect(res.status).toBe(403);
    });

    test('403 for a non-existent group (treated same as not a member)', async () => {
      const res = await request(app)
        .get('/api/groups/00000000-0000-0000-0000-000000000000')
        .set(authHeader(token));
      expect(res.status).toBe(403);
    });

    test('401 without auth token', async () => {
      const res = await request(app).get(`/api/groups/${groupA.id}`);
      expect(res.status).toBe(401);
    });
  });
});

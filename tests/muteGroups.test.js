const {
  request, app, prisma,
  createUser, createGroup, addMember, createPost,
  deleteUser, deleteGroup, deletePost,
  signToken, authHeader,
} = require('./helpers');

describe('Mute Groups API', () => {
  let user, author, token;
  let groupA, groupB, postA, postB;

  beforeAll(async () => {
    [user, author] = await Promise.all([createUser(), createUser()]);
    token = signToken({ userId: user.id, role: user.role });

    [groupA, groupB] = await Promise.all([createGroup(), createGroup()]);
    await Promise.all([
      addMember(user.id, groupA.id),
      addMember(author.id, groupA.id),
      addMember(user.id, groupB.id),
      addMember(author.id, groupB.id),
    ]);

    postA = await createPost(author.id, groupA.id, { title: 'Post in A' });
    postB = await createPost(author.id, groupB.id, { title: 'Post in B' });
  });

  afterAll(async () => {
    await prisma.mutedGroup.deleteMany({ where: { userId: user.id } });
    await prisma.groupMember.deleteMany({ where: { groupId: { in: [groupA.id, groupB.id] } } });
    await Promise.all([deletePost(postA.id), deletePost(postB.id)]);
    await Promise.all([deleteGroup(groupA.id), deleteGroup(groupB.id)]);
    await Promise.all([deleteUser(user.id), deleteUser(author.id)]);
  });

  describe('POST/DELETE /api/groups/:groupId/mute', () => {
    test('mutes a group the user is a member of', async () => {
      const res = await request(app).post(`/api/groups/${groupA.id}/mute`).set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ isMuted: true });
    });

    test('is idempotent when muting twice', async () => {
      const res = await request(app).post(`/api/groups/${groupA.id}/mute`).set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ isMuted: true });
    });

    test('403s muting a group the user cannot access', async () => {
      const otherGroup = await createGroup();
      const res = await request(app).post(`/api/groups/${otherGroup.id}/mute`).set(authHeader(token));
      expect(res.status).toBe(403);
      await deleteGroup(otherGroup.id);
    });

    test('unmutes a muted group', async () => {
      const res = await request(app).delete(`/api/groups/${groupA.id}/mute`).set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ isMuted: false });
    });

    test('unmuting an already-unmuted group is a no-op success, not a 404', async () => {
      const res = await request(app).delete(`/api/groups/${groupA.id}/mute`).set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ isMuted: false });
    });
  });

  describe('GET /api/groups isMuted field', () => {
    test('reflects muted state on the correct group only', async () => {
      await request(app).post(`/api/groups/${groupA.id}/mute`).set(authHeader(token));

      const res = await request(app).get('/api/groups').set(authHeader(token));
      const flat = res.body.flatMap((g) => g.children ?? [g]);

      expect(flat.find((g) => g.id === groupA.id).isMuted).toBe(true);
      expect(flat.find((g) => g.id === groupB.id).isMuted).toBe(false);

      await request(app).delete(`/api/groups/${groupA.id}/mute`).set(authHeader(token));
    });
  });

  describe('GET /api/posts feed exclusion', () => {
    test('excludes muted group posts from the All Groups feed', async () => {
      await request(app).post(`/api/groups/${groupA.id}/mute`).set(authHeader(token));

      const res = await request(app).get('/api/posts').set(authHeader(token));
      const ids = res.body.posts.map((p) => p.id);

      expect(ids).not.toContain(postA.id);
      expect(ids).toContain(postB.id);

      await request(app).delete(`/api/groups/${groupA.id}/mute`).set(authHeader(token));
    });

    test('still shows muted group posts when navigating directly to that group', async () => {
      await request(app).post(`/api/groups/${groupA.id}/mute`).set(authHeader(token));

      const res = await request(app).get('/api/posts').query({ groupId: groupA.id }).set(authHeader(token));
      expect(res.body.posts.map((p) => p.id)).toContain(postA.id);

      await request(app).delete(`/api/groups/${groupA.id}/mute`).set(authHeader(token));
    });

    test('returns an empty feed, not an error, when every accessible group is muted', async () => {
      // The test DB may have other seeded groups (e.g. public ones) this user can
      // already see, so mute everything currently accessible, not just A and B.
      const groupsRes = await request(app).get('/api/groups').set(authHeader(token));
      const accessibleIds = groupsRes.body.flatMap((g) => (g.children ?? [g]).map((c) => c.id));

      await Promise.all(
        accessibleIds.map((id) => request(app).post(`/api/groups/${id}/mute`).set(authHeader(token)))
      );

      const res = await request(app).get('/api/posts').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.posts).toEqual([]);

      const topRes = await request(app).get('/api/posts').query({ sort: 'top' }).set(authHeader(token));
      expect(topRes.status).toBe(200);
      expect(topRes.body.posts).toEqual([]);

      await Promise.all(
        accessibleIds.map((id) => request(app).delete(`/api/groups/${id}/mute`).set(authHeader(token)))
      );
    });
  });
});

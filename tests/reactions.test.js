const {
  request, app, prisma,
  createUser, createGroup, addMember, createPost,
  deleteUser, deleteGroup, deletePost,
  signToken, authHeader,
} = require('./helpers');

describe('Reactions API', () => {
  let member, outsider;
  let memberToken, outsiderToken;
  let group, post;

  beforeAll(async () => {
    [member, outsider] = await Promise.all([createUser(), createUser()]);
    memberToken = signToken({ userId: member.id, role: member.role });
    outsiderToken = signToken({ userId: outsider.id, role: outsider.role });

    group = await createGroup();
    await addMember(member.id, group.id);
    post = await createPost(member.id, group.id, { title: 'Reaction Post' });
  });

  afterAll(async () => {
    await deletePost(post.id);
    await deleteGroup(group.id);
    await Promise.all([deleteUser(member.id), deleteUser(outsider.id)]);
  });

  // Clean up reactions between tests
  afterEach(async () => {
    await prisma.reaction.deleteMany({ where: { postId: post.id } });
  });

  // ─── POST /api/posts/:postId/reactions ──────────────────────────────────────

  describe('POST /api/posts/:postId/reactions', () => {
    test('200 and reaction object for "with_you"', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/reactions`)
        .set(authHeader(memberToken))
        .send({ type: 'with_you' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ postId: post.id, type: 'with_you' });
    });

    test('200 and reaction object for "helped_me"', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/reactions`)
        .set(authHeader(memberToken))
        .send({ type: 'helped_me' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ postId: post.id, type: 'helped_me' });
    });

    test('200 and updates type when reacting with a different type (upsert)', async () => {
      await request(app)
        .post(`/api/posts/${post.id}/reactions`)
        .set(authHeader(memberToken))
        .send({ type: 'with_you' });
      const res = await request(app)
        .post(`/api/posts/${post.id}/reactions`)
        .set(authHeader(memberToken))
        .send({ type: 'helped_me' });
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('helped_me');
    });

    test('400 for an invalid reaction type', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/reactions`)
        .set(authHeader(memberToken))
        .send({ type: 'love' });
      expect(res.status).toBe(400);
    });

    test('400 when type is missing', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/reactions`)
        .set(authHeader(memberToken))
        .send({});
      expect(res.status).toBe(400);
    });

    test('403 for a user not in the group', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/reactions`)
        .set(authHeader(outsiderToken))
        .send({ type: 'with_you' });
      expect(res.status).toBe(403);
    });

    test('401 without auth token', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/reactions`)
        .send({ type: 'with_you' });
      expect(res.status).toBe(401);
    });
  });

  // ─── DELETE /api/posts/:postId/reactions ────────────────────────────────────

  describe('DELETE /api/posts/:postId/reactions', () => {
    test('200 and success message when removing an existing reaction', async () => {
      await request(app)
        .post(`/api/posts/${post.id}/reactions`)
        .set(authHeader(memberToken))
        .send({ type: 'with_you' });
      const res = await request(app)
        .delete(`/api/posts/${post.id}/reactions`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/removed/i);
    });

    test('404 when trying to remove a reaction that does not exist', async () => {
      const res = await request(app)
        .delete(`/api/posts/${post.id}/reactions`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(404);
    });

    test('401 without auth token', async () => {
      const res = await request(app).delete(`/api/posts/${post.id}/reactions`);
      expect(res.status).toBe(401);
    });
  });
});

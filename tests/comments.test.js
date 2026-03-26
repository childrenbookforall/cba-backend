const {
  request, app, prisma,
  createUser, createAdmin, createGroup, addMember, createPost, createComment,
  deleteUser, deleteGroup, deletePost,
  signToken, authHeader,
} = require('./helpers');

describe('Comments API', () => {
  let author, member2, admin, outsider;
  let authorToken, member2Token, adminToken, outsiderToken;
  let group, post;

  beforeAll(async () => {
    [author, member2, admin, outsider] = await Promise.all([
      createUser(),
      createUser(),
      createAdmin(),
      createUser(),
    ]);
    authorToken = signToken({ userId: author.id, role: author.role });
    member2Token = signToken({ userId: member2.id, role: member2.role });
    adminToken = signToken({ userId: admin.id, role: admin.role });
    outsiderToken = signToken({ userId: outsider.id, role: outsider.role });

    group = await createGroup();
    await Promise.all([
      addMember(author.id, group.id),
      addMember(member2.id, group.id),
      addMember(admin.id, group.id),
    ]);
    post = await createPost(author.id, group.id, { title: 'Post for comments' });
  });

  afterAll(async () => {
    await deletePost(post.id);
    await deleteGroup(group.id);
    await Promise.all([
      deleteUser(author.id),
      deleteUser(member2.id),
      deleteUser(admin.id),
      deleteUser(outsider.id),
    ]);
  });

  // ─── GET /api/posts/:postId/comments ────────────────────────────────────────

  describe('GET /api/posts/:postId/comments', () => {
    let comment, reply;

    beforeAll(async () => {
      comment = await createComment(post.id, author.id, { content: 'Top-level comment' });
      reply = await createComment(post.id, member2.id, {
        content: 'A reply',
        parentId: comment.id,
      });
    });

    afterAll(async () => {
      await prisma.comment.deleteMany({ where: { id: { in: [reply.id, comment.id] } } });
    });

    test('200 and list of top-level comments with nested replies', async () => {
      const res = await request(app)
        .get(`/api/posts/${post.id}/comments`)
        .set(authHeader(authorToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const topLevel = res.body.find((c) => c.id === comment.id);
      expect(topLevel).toBeDefined();
      expect(Array.isArray(topLevel.replies)).toBe(true);
      const nestedReply = topLevel.replies.find((r) => r.id === reply.id);
      expect(nestedReply).toBeDefined();
    });

    test('top-level list does not include replies directly', async () => {
      const res = await request(app)
        .get(`/api/posts/${post.id}/comments`)
        .set(authHeader(authorToken));
      const topLevelIds = res.body.map((c) => c.id);
      expect(topLevelIds).not.toContain(reply.id);
    });

    test('403 for a user not in the group', async () => {
      const res = await request(app)
        .get(`/api/posts/${post.id}/comments`)
        .set(authHeader(outsiderToken));
      expect(res.status).toBe(403);
    });

    test('401 without auth token', async () => {
      const res = await request(app).get(`/api/posts/${post.id}/comments`);
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /api/posts/:postId/comments ───────────────────────────────────────

  describe('POST /api/posts/:postId/comments', () => {
    const createdIds = [];

    afterAll(async () => {
      await prisma.comment.deleteMany({ where: { id: { in: createdIds } } });
    });

    test('201 and created comment for a group member', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set(authHeader(member2Token))
        .send({ content: 'Great post!' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ content: 'Great post!', parentId: null });
      createdIds.push(res.body.id);
    });

    test('201 and created reply when parentId is valid', async () => {
      const parent = await createComment(post.id, author.id);
      const res = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set(authHeader(member2Token))
        .send({ content: 'Reply here', parentId: parent.id });
      expect(res.status).toBe(201);
      expect(res.body.parentId).toBe(parent.id);
      createdIds.push(res.body.id, parent.id);
    });

    test('400 when content is missing', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set(authHeader(member2Token))
        .send({});
      expect(res.status).toBe(400);
    });

    test('400 when content exceeds 5000 characters', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set(authHeader(member2Token))
        .send({ content: 'a'.repeat(5001) });
      expect(res.status).toBe(400);
    });

    test('400 when parentId is not a valid UUID', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set(authHeader(member2Token))
        .send({ content: 'Reply', parentId: 'not-a-uuid' });
      expect(res.status).toBe(400);
    });

    test('400 when parentId is itself a reply (no threading beyond 1 level)', async () => {
      const parent = await createComment(post.id, author.id);
      const reply = await createComment(post.id, author.id, { parentId: parent.id });
      const res = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set(authHeader(member2Token))
        .send({ content: 'Deep reply', parentId: reply.id });
      expect(res.status).toBe(400);
      createdIds.push(reply.id, parent.id);
    });

    test('403 for a user not in the group', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set(authHeader(outsiderToken))
        .send({ content: 'Sneaky comment' });
      expect(res.status).toBe(403);
    });

    test('401 without auth token', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .send({ content: 'No auth' });
      expect(res.status).toBe(401);
    });
  });

  // ─── PUT /api/comments/:commentId ───────────────────────────────────────────

  describe('PUT /api/comments/:commentId', () => {
    let comment;

    beforeAll(async () => {
      comment = await createComment(post.id, author.id, { content: 'Original' });
    });

    afterAll(async () => {
      await prisma.comment.deleteMany({ where: { id: comment.id } });
    });

    test('200 and updated comment when author edits it', async () => {
      const res = await request(app)
        .put(`/api/comments/${comment.id}`)
        .set(authHeader(authorToken))
        .send({ content: 'Edited content' });
      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Edited content');
    });

    test('403 when another member tries to edit the comment', async () => {
      const res = await request(app)
        .put(`/api/comments/${comment.id}`)
        .set(authHeader(member2Token))
        .send({ content: 'Hijacked' });
      expect(res.status).toBe(403);
    });

    test('400 when content exceeds 5000 characters', async () => {
      const res = await request(app)
        .put(`/api/comments/${comment.id}`)
        .set(authHeader(authorToken))
        .send({ content: 'a'.repeat(5001) });
      expect(res.status).toBe(400);
    });

    test('400 when content is missing', async () => {
      const res = await request(app)
        .put(`/api/comments/${comment.id}`)
        .set(authHeader(authorToken))
        .send({});
      expect(res.status).toBe(400);
    });

    test('401 without auth token', async () => {
      const res = await request(app)
        .put(`/api/comments/${comment.id}`)
        .send({ content: 'No auth' });
      expect(res.status).toBe(401);
    });
  });

  // ─── DELETE /api/comments/:commentId ────────────────────────────────────────

  describe('DELETE /api/comments/:commentId', () => {
    test('200 when comment author deletes their comment', async () => {
      const comment = await createComment(post.id, author.id, { content: 'Delete me' });
      const res = await request(app)
        .delete(`/api/comments/${comment.id}`)
        .set(authHeader(authorToken));
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deleted/i);
    });

    test('200 when admin deletes another user\'s comment', async () => {
      const comment = await createComment(post.id, author.id, { content: 'Admin deletes' });
      const res = await request(app)
        .delete(`/api/comments/${comment.id}`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
    });

    test('403 when a non-author, non-admin member tries to delete', async () => {
      const comment = await createComment(post.id, author.id, { content: 'Protected' });
      const res = await request(app)
        .delete(`/api/comments/${comment.id}`)
        .set(authHeader(member2Token));
      expect(res.status).toBe(403);
      await prisma.comment.deleteMany({ where: { id: comment.id } });
    });

    test('404 for a non-existent comment', async () => {
      const res = await request(app)
        .delete('/api/comments/00000000-0000-0000-0000-000000000000')
        .set(authHeader(adminToken));
      expect(res.status).toBe(404);
    });

    test('401 without auth token', async () => {
      const comment = await createComment(post.id, author.id, { content: 'No auth delete' });
      const res = await request(app).delete(`/api/comments/${comment.id}`);
      expect(res.status).toBe(401);
      await prisma.comment.deleteMany({ where: { id: comment.id } });
    });
  });

  // ─── POST /api/comments/:commentId/flag ─────────────────────────────────────

  describe('POST /api/comments/:commentId/flag', () => {
    let comment;

    beforeAll(async () => {
      comment = await createComment(post.id, author.id, { content: 'Flaggable comment' });
    });

    afterAll(async () => {
      await prisma.flag.deleteMany({ where: { commentId: comment.id } });
      await prisma.comment.deleteMany({ where: { id: comment.id } });
    });

    test('200 after flagging a comment', async () => {
      const res = await request(app)
        .post(`/api/comments/${comment.id}/flag`)
        .set(authHeader(member2Token))
        .send({ reason: 'Offensive' });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/flagged/i);
    });

    test('409 when flagging the same comment twice', async () => {
      const res = await request(app)
        .post(`/api/comments/${comment.id}/flag`)
        .set(authHeader(member2Token))
        .send({ reason: 'Again' });
      expect(res.status).toBe(409);
    });

    test('403 for a user not in the group', async () => {
      const res = await request(app)
        .post(`/api/comments/${comment.id}/flag`)
        .set(authHeader(outsiderToken))
        .send({ reason: 'Spam' });
      expect(res.status).toBe(403);
    });

    test('401 without auth token', async () => {
      const res = await request(app)
        .post(`/api/comments/${comment.id}/flag`)
        .send({ reason: 'Spam' });
      expect(res.status).toBe(401);
    });
  });
});

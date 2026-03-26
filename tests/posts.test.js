const {
  request, app, prisma,
  createUser, createAdmin, createGroup, addMember, createPost,
  deleteUser, deleteGroup, deletePost,
  signToken, authHeader,
} = require('./helpers');

describe('Posts API', () => {
  let member, admin, outsider;
  let memberToken, adminToken, outsiderToken;
  let group, otherGroup;

  beforeAll(async () => {
    [member, admin, outsider] = await Promise.all([
      createUser(),
      createAdmin(),
      createUser(),
    ]);
    memberToken = signToken({ userId: member.id, role: member.role });
    adminToken = signToken({ userId: admin.id, role: admin.role });
    outsiderToken = signToken({ userId: outsider.id, role: outsider.role });

    group = await createGroup();
    otherGroup = await createGroup();
    await Promise.all([
      addMember(member.id, group.id),
      addMember(admin.id, group.id),
      // outsider is NOT added to group
    ]);
  });

  afterAll(async () => {
    await deleteGroup(group.id);
    await deleteGroup(otherGroup.id);
    await Promise.all([
      deleteUser(member.id),
      deleteUser(admin.id),
      deleteUser(outsider.id),
    ]);
  });

  // ─── GET /api/posts ─────────────────────────────────────────────────────────

  describe('GET /api/posts', () => {
    let post;

    beforeAll(async () => {
      post = await createPost(member.id, group.id, { title: 'Feed Post' });
    });

    afterAll(async () => {
      await deletePost(post.id);
    });

    test('200 and list of posts for authenticated member', async () => {
      const res = await request(app)
        .get('/api/posts')
        .set(authHeader(memberToken));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('posts');
      expect(Array.isArray(res.body.posts)).toBe(true);
    });

    test('posts only come from groups the user is a member of', async () => {
      const outsiderPost = await createPost(outsider.id, otherGroup.id, {
        title: 'Hidden Post',
      });
      const res = await request(app)
        .get('/api/posts')
        .set(authHeader(memberToken));
      const ids = res.body.posts.map((p) => p.id);
      expect(ids).not.toContain(outsiderPost.id);
      await deletePost(outsiderPost.id);
    });

    test('filters by groupId when provided', async () => {
      const res = await request(app)
        .get(`/api/posts?groupId=${group.id}`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(200);
      res.body.posts.forEach((p) => expect(p.groupId).toBe(group.id));
    });

    test('403 when filtering by a group the user is not a member of', async () => {
      const res = await request(app)
        .get(`/api/posts?groupId=${otherGroup.id}`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(403);
    });

    test('sort=top returns hasMore and page fields', async () => {
      const res = await request(app)
        .get('/api/posts?sort=top')
        .set(authHeader(memberToken));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('hasMore');
    });

    test('default (latest) feed has nextCursor field', async () => {
      const res = await request(app)
        .get('/api/posts')
        .set(authHeader(memberToken));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('nextCursor');
    });

    test('each post includes myReaction field', async () => {
      const res = await request(app)
        .get('/api/posts')
        .set(authHeader(memberToken));
      expect(res.status).toBe(200);
      if (res.body.posts.length > 0) {
        expect(res.body.posts[0]).toHaveProperty('myReaction');
      }
    });

    test('401 without auth token', async () => {
      const res = await request(app).get('/api/posts');
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /api/posts/:postId ─────────────────────────────────────────────────

  describe('GET /api/posts/:postId', () => {
    let post;

    beforeAll(async () => {
      post = await createPost(member.id, group.id, { title: 'Single Post' });
    });

    afterAll(async () => {
      await deletePost(post.id);
    });

    test('200 and post data for a member of the group', async () => {
      const res = await request(app)
        .get(`/api/posts/${post.id}`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: post.id, title: 'Single Post' });
    });

    test('403 for a user who is not a member of the post group', async () => {
      const res = await request(app)
        .get(`/api/posts/${post.id}`)
        .set(authHeader(outsiderToken));
      expect(res.status).toBe(403);
    });

    test('404 for a non-existent post', async () => {
      const res = await request(app)
        .get('/api/posts/00000000-0000-0000-0000-000000000000')
        .set(authHeader(memberToken));
      expect(res.status).toBe(404);
    });

    test('401 without auth token', async () => {
      const res = await request(app).get(`/api/posts/${post.id}`);
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /api/posts ────────────────────────────────────────────────────────

  describe('POST /api/posts', () => {
    const createdIds = [];

    afterAll(async () => {
      await prisma.post.deleteMany({ where: { id: { in: createdIds } } });
    });

    test('201 and created text post', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(memberToken))
        .field('groupId', group.id)
        .field('type', 'text')
        .field('title', 'My Text Post')
        .field('content', 'Body here');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ type: 'text', title: 'My Text Post' });
      createdIds.push(res.body.id);
    });

    test('201 and created link post with valid URL', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(memberToken))
        .field('groupId', group.id)
        .field('type', 'link')
        .field('title', 'My Link Post')
        .field('linkUrl', 'https://example.com');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ type: 'link', linkUrl: 'https://example.com' });
      createdIds.push(res.body.id);
    });

    test('400 when link post is missing linkUrl', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(memberToken))
        .field('groupId', group.id)
        .field('type', 'link')
        .field('title', 'Broken Link Post');
      expect(res.status).toBe(400);
    });

    test('400 when linkUrl is not a valid URL', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(memberToken))
        .field('groupId', group.id)
        .field('type', 'link')
        .field('title', 'Bad URL Post')
        .field('linkUrl', 'not-a-url');
      expect(res.status).toBe(400);
    });

    test('400 when photo post is missing the media file', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(memberToken))
        .field('groupId', group.id)
        .field('type', 'photo')
        .field('title', 'No Photo Post');
      expect(res.status).toBe(400);
    });

    test('400 when title is missing', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(memberToken))
        .field('groupId', group.id)
        .field('type', 'text');
      expect(res.status).toBe(400);
    });

    test('400 when title exceeds 200 characters', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(memberToken))
        .field('groupId', group.id)
        .field('type', 'text')
        .field('title', 'a'.repeat(201));
      expect(res.status).toBe(400);
    });

    test('400 when content exceeds 10000 characters', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(memberToken))
        .field('groupId', group.id)
        .field('type', 'text')
        .field('title', 'Too Long Content')
        .field('content', 'a'.repeat(10001));
      expect(res.status).toBe(400);
    });

    test('400 when type is invalid', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(memberToken))
        .field('groupId', group.id)
        .field('type', 'video')
        .field('title', 'Wrong Type');
      expect(res.status).toBe(400);
    });

    test('403 when user is not a member of the group', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(outsiderToken))
        .field('groupId', group.id)
        .field('type', 'text')
        .field('title', 'Outsider Post');
      expect(res.status).toBe(403);
    });

    test('400 when attaching a file to a text post', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set(authHeader(memberToken))
        .field('groupId', group.id)
        .field('type', 'text')
        .field('title', 'Text with file')
        .attach('media', Buffer.from('fake-image'), {
          filename: 'img.jpg',
          contentType: 'image/jpeg',
        });
      expect(res.status).toBe(400);
    });

    test('401 without auth token', async () => {
      const res = await request(app)
        .post('/api/posts')
        .field('groupId', group.id)
        .field('type', 'text')
        .field('title', 'No Auth Post');
      expect(res.status).toBe(401);
    });
  });

  // ─── PUT /api/posts/:postId ─────────────────────────────────────────────────

  describe('PUT /api/posts/:postId', () => {
    let post;

    beforeAll(async () => {
      post = await createPost(member.id, group.id, { title: 'Original Title' });
    });

    afterAll(async () => {
      await deletePost(post.id);
    });

    test('200 and updated post when author edits their own post', async () => {
      const res = await request(app)
        .put(`/api/posts/${post.id}`)
        .set(authHeader(memberToken))
        .send({ title: 'Updated Title', content: 'Updated content' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Title');
    });

    test('403 when a different member tries to edit the post', async () => {
      const otherMember = await createUser();
      await addMember(otherMember.id, group.id);
      const otherToken = signToken({ userId: otherMember.id, role: otherMember.role });
      const res = await request(app)
        .put(`/api/posts/${post.id}`)
        .set(authHeader(otherToken))
        .send({ title: 'Hijacked Title' });
      expect(res.status).toBe(403);
      await prisma.groupMember.deleteMany({ where: { userId: otherMember.id } });
      await deleteUser(otherMember.id);
    });

    test('400 when title exceeds 200 characters', async () => {
      const res = await request(app)
        .put(`/api/posts/${post.id}`)
        .set(authHeader(memberToken))
        .send({ title: 'a'.repeat(201) });
      expect(res.status).toBe(400);
    });

    test('401 without auth token', async () => {
      const res = await request(app)
        .put(`/api/posts/${post.id}`)
        .send({ title: 'No Auth' });
      expect(res.status).toBe(401);
    });
  });

  // ─── DELETE /api/posts/:postId ──────────────────────────────────────────────

  describe('DELETE /api/posts/:postId', () => {
    test('200 when post author deletes their own post', async () => {
      const post = await createPost(member.id, group.id, { title: 'Delete Me' });
      const res = await request(app)
        .delete(`/api/posts/${post.id}`)
        .set(authHeader(memberToken));
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deleted/i);
    });

    test('200 when admin deletes another user\'s post', async () => {
      const post = await createPost(member.id, group.id, { title: 'Admin Deletes' });
      const res = await request(app)
        .delete(`/api/posts/${post.id}`)
        .set(authHeader(adminToken));
      expect(res.status).toBe(200);
    });

    test('403 when a non-author, non-admin member tries to delete', async () => {
      const post = await createPost(member.id, group.id, { title: 'Protected Post' });
      const other = await createUser();
      await addMember(other.id, group.id);
      const otherToken = signToken({ userId: other.id, role: other.role });
      const res = await request(app)
        .delete(`/api/posts/${post.id}`)
        .set(authHeader(otherToken));
      expect(res.status).toBe(403);
      await prisma.groupMember.deleteMany({ where: { userId: other.id } });
      await deleteUser(other.id);
      await deletePost(post.id);
    });

    test('404 for a non-existent post', async () => {
      const res = await request(app)
        .delete('/api/posts/00000000-0000-0000-0000-000000000000')
        .set(authHeader(memberToken));
      expect(res.status).toBe(404);
    });

    test('401 without auth token', async () => {
      const post = await createPost(member.id, group.id, { title: 'No Auth Delete' });
      const res = await request(app).delete(`/api/posts/${post.id}`);
      expect(res.status).toBe(401);
      await deletePost(post.id);
    });
  });

  // ─── POST /api/posts/:postId/flag ───────────────────────────────────────────

  describe('POST /api/posts/:postId/flag', () => {
    let post;

    beforeAll(async () => {
      post = await createPost(member.id, group.id, { title: 'Flaggable Post' });
    });

    afterAll(async () => {
      await prisma.flag.deleteMany({ where: { postId: post.id } });
      await deletePost(post.id);
    });

    test('200 after flagging a post in a group you belong to', async () => {
      const flagger = await createUser();
      await addMember(flagger.id, group.id);
      const flaggerToken = signToken({ userId: flagger.id, role: flagger.role });
      const res = await request(app)
        .post(`/api/posts/${post.id}/flag`)
        .set(authHeader(flaggerToken))
        .send({ reason: 'Spam' });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/flagged/i);
      await prisma.groupMember.deleteMany({ where: { userId: flagger.id } });
      await deleteUser(flagger.id);
    });

    test('409 when flagging the same post twice', async () => {
      const flagger = await createUser();
      await addMember(flagger.id, group.id);
      const flaggerToken = signToken({ userId: flagger.id, role: flagger.role });
      await request(app)
        .post(`/api/posts/${post.id}/flag`)
        .set(authHeader(flaggerToken))
        .send({ reason: 'First flag' });
      const res = await request(app)
        .post(`/api/posts/${post.id}/flag`)
        .set(authHeader(flaggerToken))
        .send({ reason: 'Second flag' });
      expect(res.status).toBe(409);
      await prisma.groupMember.deleteMany({ where: { userId: flagger.id } });
      await deleteUser(flagger.id);
    });

    test('403 when user is not a member of the post group', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/flag`)
        .set(authHeader(outsiderToken))
        .send({ reason: 'Spam' });
      expect(res.status).toBe(403);
    });

    test('401 without auth token', async () => {
      const res = await request(app)
        .post(`/api/posts/${post.id}/flag`)
        .send({ reason: 'Spam' });
      expect(res.status).toBe(401);
    });
  });
});

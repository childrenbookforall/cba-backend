const {
  request, app, prisma,
  createUser, createGroup, addMember, createPost, createComment,
  deleteUser, deleteGroup, deletePost,
  signToken, authHeader,
} = require('./helpers');

describe('Notifications API', () => {
  let postAuthor, commenter;
  let postAuthorToken, commenterToken;
  let group, post;

  beforeAll(async () => {
    [postAuthor, commenter] = await Promise.all([createUser(), createUser()]);
    postAuthorToken = signToken({ userId: postAuthor.id, role: postAuthor.role });
    commenterToken = signToken({ userId: commenter.id, role: commenter.role });

    group = await createGroup();
    await Promise.all([
      addMember(postAuthor.id, group.id),
      addMember(commenter.id, group.id),
    ]);
    post = await createPost(postAuthor.id, group.id, { title: 'Notification Test Post' });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { recipientId: { in: [postAuthor.id, commenter.id] } },
    });
    await deletePost(post.id);
    await deleteGroup(group.id);
    await Promise.all([deleteUser(postAuthor.id), deleteUser(commenter.id)]);
  });

  // ─── GET /api/notifications ─────────────────────────────────────────────────

  describe('GET /api/notifications', () => {
    let comment;

    beforeAll(async () => {
      // Commenter comments on postAuthor's post → creates a notification for postAuthor
      const res = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set(authHeader(commenterToken))
        .send({ content: 'Hey, nice post!' });
      comment = res.body;
    });

    afterAll(async () => {
      await prisma.comment.deleteMany({ where: { id: comment.id } });
    });

    test('200 and list of unread notifications for the recipient', async () => {
      const res = await request(app)
        .get('/api/notifications')
        .set(authHeader(postAuthorToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const notif = res.body.find(
        (n) => n.type === 'post_comment' && n.postId === post.id
      );
      expect(notif).toBeDefined();
    });

    test('response includes triggeredBy, post, and comment details', async () => {
      const res = await request(app)
        .get('/api/notifications')
        .set(authHeader(postAuthorToken));
      expect(res.status).toBe(200);
      if (res.body.length > 0) {
        const notif = res.body[0];
        expect(notif).toHaveProperty('triggeredBy');
        expect(notif).toHaveProperty('post');
        expect(notif).toHaveProperty('comment');
        expect(notif.isRead).toBe(false);
      }
    });

    test('commenter does NOT receive a notification when commenting on their own post', async () => {
      const ownPost = await createPost(commenter.id, group.id, { title: 'Own Post' });
      await request(app)
        .post(`/api/posts/${ownPost.id}/comments`)
        .set(authHeader(commenterToken))
        .send({ content: 'Self comment' });
      const res = await request(app)
        .get('/api/notifications')
        .set(authHeader(commenterToken));
      const selfNotif = res.body.find((n) => n.postId === ownPost.id);
      expect(selfNotif).toBeUndefined();
      await deletePost(ownPost.id);
    });

    test('only returns unread notifications', async () => {
      const res = await request(app)
        .get('/api/notifications')
        .set(authHeader(postAuthorToken));
      expect(res.status).toBe(200);
      res.body.forEach((n) => expect(n.isRead).toBe(false));
    });

    test('401 without auth token', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });
  });

  // ─── PATCH /api/notifications/read ──────────────────────────────────────────

  describe('PATCH /api/notifications/read', () => {
    let comment;

    beforeEach(async () => {
      // Create a fresh notification
      const res = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set(authHeader(commenterToken))
        .send({ content: 'Another comment' });
      comment = res.body;
    });

    afterEach(async () => {
      await prisma.notification.deleteMany({ where: { recipientId: postAuthor.id } });
      if (comment?.id) {
        await prisma.comment.deleteMany({ where: { id: comment.id } });
      }
    });

    test('200 after marking all notifications as read', async () => {
      const res = await request(app)
        .patch('/api/notifications/read')
        .set(authHeader(postAuthorToken));
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/marked as read/i);
    });

    test('notifications are actually marked as read after the call', async () => {
      await request(app)
        .patch('/api/notifications/read')
        .set(authHeader(postAuthorToken));
      const res = await request(app)
        .get('/api/notifications')
        .set(authHeader(postAuthorToken));
      expect(res.status).toBe(200);
      // All unread should now be zero
      expect(res.body.length).toBe(0);
    });

    test('401 without auth token', async () => {
      const res = await request(app).patch('/api/notifications/read');
      expect(res.status).toBe(401);
    });
  });
});

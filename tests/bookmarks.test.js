const {
  request, app, prisma,
  createUser, createGroup, addMember, createPost,
  deleteUser, deleteGroup, deletePost,
  signToken, authHeader,
} = require('./helpers');
const { invalidatePublicGroupsCache } = require('../src/lib/groupAccess');

describe('Bookmarks API', () => {
  let user, author, token;
  let group, post;

  beforeAll(async () => {
    [user, author] = await Promise.all([createUser(), createUser()]);
    token = signToken({ userId: user.id, role: user.role });

    group = await createGroup();
    await Promise.all([
      addMember(user.id, group.id),
      addMember(author.id, group.id),
    ]);
    post = await createPost(author.id, group.id, { title: 'Bookmarked Post' });
    await prisma.bookmark.create({ data: { userId: user.id, postId: post.id } });
  });

  afterAll(async () => {
    await prisma.bookmark.deleteMany({ where: { userId: user.id } });
    await prisma.groupMember.deleteMany({ where: { groupId: group.id } });
    await deletePost(post.id);
    await deleteGroup(group.id);
    await Promise.all([deleteUser(user.id), deleteUser(author.id)]);
  });

  describe('GET /api/bookmarks', () => {
    test('returns a bookmarked post the user can still access', async () => {
      const res = await request(app).get('/api/bookmarks').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.posts.map((p) => p.id)).toContain(post.id);
    });

    test('excludes a bookmark in a group the user has been removed from', async () => {
      // Simulate removal from the group the bookmarked post lives in
      await prisma.groupMember.deleteMany({ where: { userId: user.id, groupId: group.id } });

      const res = await request(app).get('/api/bookmarks').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.posts.map((p) => p.id)).not.toContain(post.id);

      // Restore membership so other assertions/ordering stay independent
      await addMember(user.id, group.id);
    });

    test('still returns the bookmark if the group is public, even without membership', async () => {
      await prisma.groupMember.deleteMany({ where: { userId: user.id, groupId: group.id } });
      await prisma.group.update({ where: { id: group.id }, data: { isPublic: true } });
      invalidatePublicGroupsCache();

      const res = await request(app).get('/api/bookmarks').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.posts.map((p) => p.id)).toContain(post.id);

      await prisma.group.update({ where: { id: group.id }, data: { isPublic: false } });
      invalidatePublicGroupsCache();
      await addMember(user.id, group.id);
    });
  });
});

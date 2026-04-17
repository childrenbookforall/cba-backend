const { prisma, createUser, createGroup, addMember, deleteUser, deleteGroup } = require('./helpers');
const birthdayPostsJob = require('../src/jobs/birthdayPosts.job');

describe('birthdayPostsJob', () => {
  let user, groupA, groupB;

  beforeAll(async () => {
    const today = new Date();
    const birthday = new Date(Date.UTC(1990, today.getUTCMonth(), today.getUTCDate()));

    user = await createUser({ birthday });
    [groupA, groupB] = await Promise.all([createGroup(), createGroup()]);
    await Promise.all([addMember(user.id, groupA.id), addMember(user.id, groupB.id)]);
  });

  afterAll(async () => {
    await prisma.post.deleteMany({ where: { groupId: { in: [groupA.id, groupB.id] } } });
    await deleteGroup(groupA.id);
    await deleteGroup(groupB.id);
    await deleteUser(user.id);
  });

  test('creates a birthday post in each group the user belongs to', async () => {
    await birthdayPostsJob();

    const posts = await prisma.post.findMany({
      where: { groupId: { in: [groupA.id, groupB.id] } },
    });

    expect(posts).toHaveLength(2);
    expect(posts.every((p) => p.userId === null)).toBe(true);
    expect(posts.every((p) => p.title.includes(user.firstName))).toBe(true);
    expect(posts.every((p) => p.type === 'text')).toBe(true);
  });

  test('does not create posts for users whose birthday is not today', async () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const otherBirthday = new Date(Date.UTC(1990, yesterday.getUTCMonth(), yesterday.getUTCDate()));

    const otherUser = await createUser({ birthday: otherBirthday });
    const group = await createGroup();
    await addMember(otherUser.id, group.id);

    await birthdayPostsJob();

    const posts = await prisma.post.findMany({ where: { groupId: group.id } });
    expect(posts).toHaveLength(0);

    await deleteGroup(group.id);
    await deleteUser(otherUser.id);
  });
});

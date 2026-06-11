// Seeds verification data for the sidebar/group-hierarchy feature.
// Idempotent: safe to re-run.
const prisma = require('../src/prisma/client');
const bcrypt = require('bcrypt');

async function main() {
  const passwordHash = await bcrypt.hash('Password1!', 12);

  const mkUser = (email, firstName, role) =>
    prisma.user.upsert({ where: { email }, update: {}, create: { email, passwordHash, firstName, role } });

  const admin = await mkUser('verify-admin@test.local', 'Ada', 'admin');
  const member = await mkUser('verify-member@test.local', 'Mia', 'member');
  await mkUser('verify-outsider@test.local', 'Otto', 'member'); // member of nothing

  const mkGroup = (name, slug, fields = {}) =>
    prisma.group.upsert({ where: { slug }, update: fields, create: { name, slug, ...fields } });

  const projects = await mkGroup('Projects', 'projects');
  const community = await mkGroup('Community', 'community');
  const alpha = await mkGroup('Project Alpha', 'project-alpha', { parentId: projects.id, isPublic: true, isViewOnly: true });
  const beta = await mkGroup('Project Beta', 'project-beta', { parentId: projects.id, isPublic: true, isViewOnly: false });
  const bookClub = await mkGroup('Book Club', 'book-club', { parentId: community.id });
  const quiet = await mkGroup('Quiet Corner', 'quiet-corner', { parentId: community.id, isViewOnly: true });
  const general = await mkGroup('General Chat', 'general-verify');

  const addMember = (userId, groupId) =>
    prisma.groupMember.upsert({
      where: { userId_groupId: { userId, groupId } },
      update: {},
      create: { userId, groupId },
    });

  await addMember(member.id, bookClub.id);
  await addMember(member.id, quiet.id);
  await addMember(member.id, general.id);
  await addMember(admin.id, general.id);

  const ensurePost = async (userId, groupId, title) => {
    if ((await prisma.post.count({ where: { title } })) === 0) {
      await prisma.post.create({ data: { userId, groupId, type: 'text', title, content: 'Seeded for verification' } });
    }
  };

  await ensurePost(admin.id, alpha.id, 'Welcome to Project Alpha');
  await ensurePost(admin.id, beta.id, 'Beta updates thread');
  await ensurePost(member.id, bookClub.id, 'Book Club picks for June');
  await ensurePost(member.id, quiet.id, 'Quiet Corner notice');

  console.log('seeded: 3 users (Password1!), 2 parents, 4 children, 1 standalone, 4 posts');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

// Mutes a group for all of its current members and flips its mutedByDefault
// flag so future joiners start out muted too. Idempotent: safe to re-run.
// Usage: node scripts/mute-group-for-all-members.js <group-slug>
const prisma = require('../src/prisma/client');

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scripts/mute-group-for-all-members.js <group-slug>');
    process.exit(1);
  }

  const group = await prisma.group.findUnique({ where: { slug } });
  if (!group) {
    console.error(`No group found with slug "${slug}"`);
    process.exit(1);
  }

  await prisma.group.update({
    where: { id: group.id },
    data: { mutedByDefault: true },
  });

  const members = await prisma.groupMember.findMany({
    where: { groupId: group.id },
    select: { userId: true },
  });

  await prisma.mutedGroup.createMany({
    data: members.map(({ userId }) => ({ userId, groupId: group.id })),
    skipDuplicates: true,
  });

  console.log(`Muted "${group.name}" (${slug}) for ${members.length} current member(s); future joiners will start muted.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

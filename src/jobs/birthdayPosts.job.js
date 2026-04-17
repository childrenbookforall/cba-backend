const prisma = require('../prisma/client');

const BIRTHDAY_MESSAGES = [
  (name) => ({ title: `Happy Birthday, ${name}! 🌼`, content: `Today we’re celebrating you — the stories you carry, the smiles you share, and the little bit of magic you bring into our community. We’re so glad you’re here 💛` }),
  (name) => ({ title: `Happy Birthday, ${name}! ✨`, content: `If today were a story, it would be filled with warm hugs, soft laughter, and pages of joy — because you are in it. Thank you for being part of our little world 🌈` }),
  (name) => ({ title: `Happy Birthday, ${name}! 🎈`, content: `Here’s to the child within you — curious, playful, and full of wonder. May your day be full of tiny joys and big, gentle smiles 💫` }),
  (name) => ({ title: `Happy Birthday, ${name}! 💛`, content: `In this little circle of stories and hearts, you make things brighter just by being you. We’re really, really glad you’re here 🌻` }),
  (name) => ({ title: `Happy Birthday, ${name}! 🌙`, content: `May your day feel like your favorite story — safe, warm, and full of quiet magic ✨` }),
  (name) => ({ title: `Happy Birthday, ${name}! 🧸`, content: `May your day feel like a gentle story — with kind words, warm hugs, and little moments that make your heart smile 💛` }),
  (name) => ({ title: `Happy Birthday, ${name}! 💐`, content: `You are a beautiful part of this little world we’re building — thank you for bringing your light, your stories, and your wonder ✨` }),
  (name) => ({ title: `Happy Birthday, ${name}! 🌻`, content: `Today is for slow smiles, soft laughter, and doing things that make your inner child feel safe, seen, and happy 💛` }),
  (name) => ({ title: `Happy Birthday, ${name}! 🎂`, content: `Like your favorite picture book, may your day be filled with color, comfort, and a touch of magic on every page 💖` }),
  (name) => ({ title: `Happy Birthday, ${name}! 🎶`, content: `Somewhere between stories, our smiles and cries, you’ve made a home here — and we’re so lucky to have you in it 💛` }),
];

async function birthdayPostsJob() {
  const now = new Date();
  const todayMonth = now.getUTCMonth();
  const todayDay = now.getUTCDate();

  const users = await prisma.user.findMany({
    where: { birthday: { not: null }, isActive: true },
    select: {
      id: true,
      firstName: true,
      birthday: true,
      groupMemberships: { select: { groupId: true } },
    },
  });

  const birthdayUsers = users.filter((u) => {
    const bday = new Date(u.birthday);
    return bday.getUTCMonth() === todayMonth && bday.getUTCDate() === todayDay;
  });

  // Count past birthday posts to determine where we are in the rotation
  const pastCount = await prisma.post.count({ where: { userId: null } });

  for (let i = 0; i < birthdayUsers.length; i++) {
    const user = birthdayUsers[i];
    const message = BIRTHDAY_MESSAGES[(pastCount + i) % BIRTHDAY_MESSAGES.length](user.firstName);

    for (const { groupId } of user.groupMemberships) {
      await prisma.post.create({
        data: { userId: null, groupId, type: 'text', ...message },
      });
    }
  }

  console.log(`[birthdayPosts] ${birthdayUsers.length} user(s) wished happy birthday`);
}

module.exports = birthdayPostsJob;

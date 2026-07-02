const prisma = require('../prisma/client');
const turso = require('../lib/turso');
const { sendPush } = require('../services/push.service');

const READINGS_BASE_URL = 'https://childrensbookforall.org/readings';

function tomorrowDateString() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}

async function readingRemindersJob() {
  const tomorrow = tomorrowDateString();

  const result = await turso.execute({
    sql: 'SELECT id, title, bookCover, description FROM Readings WHERE date LIKE ? AND goLive = 1',
    args: [`${tomorrow}%`],
  });

  if (result.rows.length === 0) {
    return;
  }

  const subscriptions = await prisma.pushSubscription.findMany();

  for (const reading of result.rows) {
    const readingId = String(reading.id);

    const alreadyNotified = await prisma.notifiedReading.findUnique({ where: { id: readingId } });
    if (alreadyNotified) {
      continue;
    }

    const payload = {
      title: `CBA Reads: ${reading.title} tomorrow`,
      body: reading.description,
      image: reading.bookCover,
      url: `${READINGS_BASE_URL}/${readingId}`,
    };

    const expired = [];
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          const ok = await sendPush(sub, payload);
          if (!ok) expired.push(sub.id);
        } catch {
          // Non-expiry delivery error — skip this subscription
        }
      })
    );

    if (expired.length > 0) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: expired } } });
    }

    await prisma.notifiedReading.create({ data: { id: readingId } });
    console.log(`[readingReminders] sent reminder for reading ${readingId}`);
  }
}

module.exports = readingRemindersJob;

const prisma = require('../prisma/client');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const NOTIFICATIONS = [
  {
    // First live Wednesday: 2026-07-01, then every 14 days
    anchor: new Date('2026-07-01T00:00:00Z'),
    message: 'Informal Hangout with CBA Community today at 7:30 pm',
    linkText: 'Join',
    linkUrl: 'https://meet.google.com/qfj-ekyw-yph',
  },
  {
    // First live Thursday: 2026-07-09, then every 14 days
    anchor: new Date('2026-07-09T00:00:00Z'),
    message: 'Informal Hangout with CBA Community today at 7:30 pm',
    linkText: 'Join',
    linkUrl: 'https://meet.google.com/jff-kvfv-uge',
  },
];

function isScheduledDay(date, anchor) {
  const diffDays = Math.round((date - anchor) / MS_PER_DAY);
  return diffDays >= 0 && diffDays % 14 === 0;
}

async function biweeklyNotificationsJob() {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(today.getTime() - MS_PER_DAY);

  const liveNotification = NOTIFICATIONS.find((n) => isScheduledDay(today, n.anchor));

  if (liveNotification) {
    const existing = await prisma.siteNotification.findFirst();
    const data = {
      message: liveNotification.message,
      linkText: liveNotification.linkText,
      linkUrl: liveNotification.linkUrl,
      isActive: true,
    };
    if (existing) {
      await prisma.siteNotification.update({ where: { id: existing.id }, data });
    } else {
      await prisma.siteNotification.create({ data });
    }
    console.log('[biweeklyNotifications] activated today\'s hangout notification');
    return;
  }

  // Turn off the notification the day after it was live, since it should
  // only be visible for the single scheduled day.
  const wasLiveYesterday = NOTIFICATIONS.some((n) => isScheduledDay(yesterday, n.anchor));
  if (wasLiveYesterday) {
    const existing = await prisma.siteNotification.findFirst();
    if (existing) {
      await prisma.siteNotification.update({ where: { id: existing.id }, data: { isActive: false } });
      console.log('[biweeklyNotifications] deactivated hangout notification');
    }
  }
}

module.exports = biweeklyNotificationsJob;

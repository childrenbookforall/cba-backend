const prisma = require('../prisma/client');

async function getNotifications(req, res, next) {
  try {
    const notifications = await prisma.notification.findMany({
      where: { recipientId: req.user.userId, isRead: false },
      include: {
        triggeredBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        post: { select: { id: true, title: true } },
        comment: { select: { id: true, content: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(notifications);
  } catch (err) {
    next(err);
  }
}

async function markOneRead(req, res, next) {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: req.params.notificationId },
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.recipientId !== req.user.userId) {
      return res.status(403).json({ error: 'Not your notification' });
    }

    await prisma.notification.delete({
      where: { id: req.params.notificationId },
    });

    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    await prisma.notification.deleteMany({
      where: { recipientId: req.user.userId },
    });

    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
}

async function subscribe(req, res, next) {
  try {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Invalid push subscription' });
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { p256dh: keys.p256dh, auth: keys.auth },
      create: { userId: req.user.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    });

    res.status(201).json({ message: 'Subscribed to push notifications' });
  } catch (err) {
    next(err);
  }
}

async function unsubscribe(req, res, next) {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint is required' });
    }

    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: req.user.userId },
    });

    res.json({ message: 'Unsubscribed from push notifications' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getNotifications, markOneRead, markAllRead, subscribe, unsubscribe };

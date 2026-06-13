const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const { jwtSecret } = require('../config/env');

let activityCache = new Set();
let activityCacheDate = new Date().toISOString().slice(0, 10);

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Account is inactive' });
    }

    req.user = { userId: user.id, role: user.role };

    if (process.env.NODE_ENV !== 'test') {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== activityCacheDate) {
        activityCache = new Set();
        activityCacheDate = today;
      }
      if (!activityCache.has(user.id)) {
        activityCache.add(user.id);
        prisma.userDailyActivity.upsert({
          where: { userId_date: { userId: user.id, date: new Date(today) } },
          update: {},
          create: { userId: user.id, date: new Date(today) },
        }).catch((err) => console.error('Failed to record user activity:', err));
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;

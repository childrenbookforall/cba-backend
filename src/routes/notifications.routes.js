const router = require('express').Router();
const authMiddleware = require('../middleware/auth.middleware');
const { getNotifications, markOneRead, markAllRead, subscribe, unsubscribe } = require('../controllers/notifications.controller');

router.use(authMiddleware);

router.get('/', getNotifications);
router.patch('/read', markAllRead);
router.patch('/:notificationId/read', markOneRead);
router.post('/subscribe', subscribe);
router.delete('/subscribe', unsubscribe);

module.exports = router;

const router = require('express').Router();
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const { getNotifications, markOneRead, markAllRead, subscribe, unsubscribe } = require('../controllers/notifications.controller');

// Web Push endpoints are always HTTPS URLs; p256dh/auth are base64url key strings.
const httpsEndpoint = body('endpoint').isString().bail().isURL({ protocols: ['https'], require_protocol: true }).withMessage('endpoint must be a valid https URL');

router.use(authMiddleware);

router.get('/', getNotifications);
router.patch('/read', markAllRead);
router.patch('/:notificationId/read', markOneRead);
router.post('/subscribe', [
  httpsEndpoint,
  body('keys.p256dh').isString().notEmpty().withMessage('keys.p256dh is required'),
  body('keys.auth').isString().notEmpty().withMessage('keys.auth is required'),
], validateMiddleware, subscribe);
router.delete('/subscribe', [httpsEndpoint], validateMiddleware, unsubscribe);

module.exports = router;

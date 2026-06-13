const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const authMiddleware = require('../middleware/auth.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const validateCursor = require('../middleware/validateCursor');
const { getConversations, getConversation, sendMessage, markRead } = require('../controllers/messages.controller');

const sendMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.userId ?? ipKeyGenerator(req),
  message: { error: 'Too many messages sent, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

router.use(authMiddleware);
router.use(validateCursor);

router.get('/messages', getConversations);
router.get('/messages/:userId', getConversation);
router.post('/messages/:userId', sendMessageLimiter, [
  body('content').trim().notEmpty().withMessage('Message cannot be empty').isLength({ max: 2000 }).withMessage('Message too long'),
], validateMiddleware, sendMessage);
router.patch('/messages/:userId/read', markRead);

module.exports = router;

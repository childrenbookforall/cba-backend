const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const validateMiddleware = require('../middleware/validate.middleware');
const { getInvite, acceptInvite, login, refresh, logout, forgotPassword, validateResetToken, resetPassword } = require('../controllers/auth.controller');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const passwordValidation = [
  body('password')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

router.get('/invite/:token', authLimiter, getInvite);
router.post('/invite/:token', authLimiter, passwordValidation, validateMiddleware, acceptInvite);

router.post('/login', authLimiter, [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], validateMiddleware, login);

router.post('/forgot-password', authLimiter, [
  body('email').isEmail().withMessage('Valid email is required'),
], validateMiddleware, forgotPassword);

router.post('/refresh', refresh);
router.post('/logout', logout);

router.get('/reset-password/:token', authLimiter, validateResetToken);
router.post('/reset-password/:token', authLimiter, passwordValidation, validateMiddleware, resetPassword);

module.exports = router;

const router = require('express').Router();
const multer = require('multer');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth.middleware');
const validateMiddleware = require('../middleware/validate.middleware');

const updateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many update requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many search requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});
const { getMe, updateMe, uploadAvatar, getUser, searchUsers } = require('../controllers/users.controller');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('Only JPEG, PNG and WebP images are allowed'), { status: 400 }));
    }
  },
});

router.get('/search', authMiddleware, searchLimiter, searchUsers);

router.get('/me', authMiddleware, getMe);

router.put('/me', authMiddleware, updateLimiter, [
  body('bio').optional().isString().trim().isLength({ max: 500 }).withMessage('Bio cannot exceed 500 characters'),
  body('birthday').optional({ nullable: true }).isISO8601().withMessage('Birthday must be a valid date').toDate(),
], validateMiddleware, updateMe);

router.post('/me/avatar', authMiddleware, updateLimiter, avatarUpload.single('avatar'), uploadAvatar);

router.get('/:id', authMiddleware, getUser);

module.exports = router;

const router = require('express').Router();
const multer = require('multer');
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const { getMe, updateMe, uploadAvatar, getUser } = require('../controllers/users.controller');

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

router.get('/me', authMiddleware, getMe);

router.put('/me', authMiddleware, [
  body('bio').optional().isString().trim().isLength({ max: 500 }).withMessage('Bio cannot exceed 500 characters'),
], validateMiddleware, updateMe);

router.post('/me/avatar', authMiddleware, avatarUpload.single('avatar'), uploadAvatar);

router.get('/:id', authMiddleware, getUser);

module.exports = router;

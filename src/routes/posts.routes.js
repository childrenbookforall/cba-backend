const router = require('express').Router();
const multer = require('multer');
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const { getFeed, getPost, createPost, updatePost, deletePost, flagPost, searchPosts } = require('../controllers/posts.controller');

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MEDIA_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('Only JPEG, PNG and WebP images are allowed'), { status: 400 }));
    }
  },
});

router.use(authMiddleware);

router.get('/', getFeed);
router.get('/search', searchPosts);
router.get('/:postId', getPost);

router.post('/', mediaUpload.array('media', 10), [
  body('groupId').notEmpty().withMessage('Group ID is required'),
  body('type').isIn(['text', 'link', 'photo']).withMessage('Invalid post type'),
  body('title').notEmpty().isLength({ max: 200 }).withMessage('Title is required and cannot exceed 200 characters'),
  body('content').optional().isString().isLength({ max: 10000 }).withMessage('Content cannot exceed 10000 characters'),
  body('linkUrl').if(body('type').equals('link')).notEmpty().isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('A valid http/https URL is required for link posts'),
  body('type').custom((type, { req }) => {
    if (type === 'photo' && (!req.files || req.files.length === 0)) throw new Error('At least one photo file is required for photo posts');
    if (type !== 'photo' && req.files && req.files.length > 0) throw new Error('File upload is only allowed for photo posts');
    return true;
  }),
], validateMiddleware, createPost);

router.put('/:postId', [
  body('title').notEmpty().isLength({ max: 200 }).withMessage('Title is required and cannot exceed 200 characters'),
  body('content').optional().isString().isLength({ max: 10000 }).withMessage('Content cannot exceed 10000 characters'),
], validateMiddleware, updatePost);

router.delete('/:postId', deletePost);
router.post('/:postId/flag', [
  body('reason').optional().isString().trim(),
], validateMiddleware, flagPost);

module.exports = router;

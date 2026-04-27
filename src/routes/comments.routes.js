const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth.middleware');
const validateMiddleware = require('../middleware/validate.middleware');

const createCommentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many comments, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});
const { getComments, createComment, updateComment, deleteComment, flagComment } = require('../controllers/comments.controller');

router.use(authMiddleware);

// Post-scoped routes
router.get('/posts/:postId/comments', getComments);
router.post('/posts/:postId/comments', createCommentLimiter, [
  body('content').notEmpty().isLength({ max: 11000 }).withMessage('Content is required and cannot exceed 10,000 characters'),
  body('parentId').optional().isUUID().withMessage('Invalid parent comment ID'),
], validateMiddleware, createComment);

// Comment-scoped routes
router.put('/comments/:commentId', [
  body('content').notEmpty().isLength({ max: 11000 }).withMessage('Content is required and cannot exceed 10,000 characters'),
], validateMiddleware, updateComment);

router.delete('/comments/:commentId', deleteComment);
router.post('/comments/:commentId/flag', [
  body('reason').optional().isString().trim(),
], validateMiddleware, flagComment);

module.exports = router;

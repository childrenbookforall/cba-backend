const router = require('express').Router();
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const { getComments, createComment, updateComment, deleteComment, flagComment } = require('../controllers/comments.controller');

router.use(authMiddleware);

// Post-scoped routes
router.get('/posts/:postId/comments', getComments);
router.post('/posts/:postId/comments', [
  body('content').notEmpty().isLength({ max: 5000 }).withMessage('Content is required and cannot exceed 5000 characters'),
  body('parentId').optional().isUUID().withMessage('Invalid parent comment ID'),
], validateMiddleware, createComment);

// Comment-scoped routes
router.put('/comments/:commentId', [
  body('content').notEmpty().isLength({ max: 5000 }).withMessage('Content is required and cannot exceed 5000 characters'),
], validateMiddleware, updateComment);

router.delete('/comments/:commentId', deleteComment);
router.post('/comments/:commentId/flag', [
  body('reason').optional().isString().trim(),
], validateMiddleware, flagComment);

module.exports = router;

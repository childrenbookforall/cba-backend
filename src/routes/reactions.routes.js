const router = require('express').Router();
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const { upsertReaction, removeReaction, getReactors } = require('../controllers/reactions.controller');

router.use(authMiddleware);

router.post('/posts/:postId/reactions', [
  body('type').isIn(['with_you', 'helped_me', 'hug']).withMessage('Invalid reaction type'),
], validateMiddleware, upsertReaction);

router.get('/posts/:postId/reactions', getReactors);
router.delete('/posts/:postId/reactions', removeReaction);

module.exports = router;

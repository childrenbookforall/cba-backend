const router = require('express').Router();
const authMiddleware = require('../middleware/auth.middleware');
const validateCursor = require('../middleware/validateCursor');
const { addBookmark, removeBookmark, getSavedPosts } = require('../controllers/bookmarks.controller');

router.use(authMiddleware);
router.use(validateCursor);

router.get('/bookmarks', getSavedPosts);
router.post('/posts/:postId/bookmark', addBookmark);
router.delete('/posts/:postId/bookmark', removeBookmark);

module.exports = router;

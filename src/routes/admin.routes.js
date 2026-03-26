const router = require('express').Router();
const { body } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const adminMiddleware = require('../middleware/admin.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const {
  createUser, sendInvite, listUsers, suspendUser, deleteUser,
  listGroups, listGroupMembers, createGroup, addGroupMember, removeGroupMember,
  togglePinPost,
  listFlags, reviewFlag,
} = require('../controllers/admin.controller');

router.use(authMiddleware, adminMiddleware);

// Users
router.post('/users', [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
], validateMiddleware, createUser);

router.post('/users/:userId/invite', sendInvite);
router.get('/users', listUsers);
router.patch('/users/:userId/suspend', suspendUser);
router.delete('/users/:userId', deleteUser);

// Groups
router.get('/groups', listGroups);
router.get('/groups/:groupId/members', listGroupMembers);

router.post('/groups', [
  body('name').notEmpty().withMessage('Group name is required'),
  body('slug').notEmpty().matches(/^[a-z0-9-]+$/).withMessage('Slug must be lowercase letters, numbers and hyphens only'),
  body('description').optional().isString().trim(),
], validateMiddleware, createGroup);

router.post('/groups/:groupId/members', [
  body('userId').notEmpty().withMessage('User ID is required'),
], validateMiddleware, addGroupMember);

router.delete('/groups/:groupId/members/:userId', removeGroupMember);

// Posts
router.patch('/posts/:postId/pin', togglePinPost);

// Moderation
router.get('/flags', listFlags);
router.patch('/flags/:flagId/review', reviewFlag);

module.exports = router;

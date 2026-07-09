const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth.middleware');
const adminMiddleware = require('../middleware/admin.middleware');
const validateMiddleware = require('../middleware/validate.middleware');
const validateCursor = require('../middleware/validateCursor');
const {
  createUser, sendInvite, listUsers, suspendUser, deleteUser,
  listGroups, listGroupMembers, createGroup, updateGroup, deleteGroup, addGroupMember, removeGroupMember,
  togglePinPost, toggleDownrankPost,
  listFlags, reviewFlag,
  pushBroadcast,
  bulkAssignBadges,
  getSiteNotification, upsertSiteNotification, toggleSiteNotification,
  listAllConversations, getConversationThread,
} = require('../controllers/admin.controller');

const BADGE_VALUES = ['host', 'co_host', 'supporter', 'member', 'member_sabbatical'];
const MUTUALLY_EXCLUSIVE_BADGE_PAIRS = [
  ['host', 'co_host'],
  ['member', 'member_sabbatical'],
];

router.use(authMiddleware, adminMiddleware);
router.use(validateCursor);

// Users
router.post('/users', [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').optional(),
  body('email').isEmail().withMessage('Valid email is required'),
], validateMiddleware, createUser);

router.post('/users/:userId/invite', sendInvite);
router.get('/users', listUsers);
router.patch('/users/:userId/suspend', suspendUser);
router.delete('/users/:userId', deleteUser);

router.post('/badges/bulk', [
  body('assignments').isArray({ min: 1 }).withMessage('assignments must be a non-empty array'),
  body('assignments.*.email').isEmail().withMessage('Each assignment needs a valid email'),
  body('assignments.*.badges').isArray().withMessage('Each assignment needs a badges array'),
  body('assignments.*.badges.*').isIn(BADGE_VALUES).withMessage(`badges must be one of: ${BADGE_VALUES.join(', ')}`),
  body('assignments.*.badges').custom((badges) => {
    for (const [a, b] of MUTUALLY_EXCLUSIVE_BADGE_PAIRS) {
      if (Array.isArray(badges) && badges.includes(a) && badges.includes(b)) {
        throw new Error(`badges cannot include both "${a}" and "${b}"`);
      }
    }
    return true;
  }),
], validateMiddleware, bulkAssignBadges);

// Groups
router.get('/groups', listGroups);
router.get('/groups/:groupId/members', listGroupMembers);

const groupFieldValidators = [
  body('description').optional({ nullable: true }).isString().trim(),
  body('parentId').optional({ nullable: true }).isUUID().withMessage('parentId must be a valid group ID'),
  body('isPublic').optional().isBoolean().withMessage('isPublic must be a boolean'),
  body('isViewOnly').optional().isBoolean().withMessage('isViewOnly must be a boolean'),
];

router.post('/groups', [
  body('name').notEmpty().withMessage('Group name is required'),
  body('slug').notEmpty().matches(/^[a-z0-9-]+$/).withMessage('Slug must be lowercase letters, numbers and hyphens only'),
  ...groupFieldValidators,
], validateMiddleware, createGroup);

router.patch('/groups/:groupId', [
  body('name').optional().notEmpty().withMessage('Group name cannot be empty'),
  body('slug').optional().matches(/^[a-z0-9-]+$/).withMessage('Slug must be lowercase letters, numbers and hyphens only'),
  ...groupFieldValidators,
], validateMiddleware, updateGroup);

router.post('/groups/:groupId/members', [
  body('userId').notEmpty().withMessage('User ID is required'),
], validateMiddleware, addGroupMember);

router.delete('/groups/:groupId', deleteGroup);
router.delete('/groups/:groupId/members/:userId', removeGroupMember);

// Posts
router.patch('/posts/:postId/pin', togglePinPost);
router.patch('/posts/:postId/downrank', toggleDownrankPost);

// Moderation
router.get('/flags', listFlags);
router.patch('/flags/:flagId/review', reviewFlag);

// Push notifications
const broadcastLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Too many broadcast requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/push-broadcast', broadcastLimiter, [
  body('title').notEmpty().withMessage('title is required'),
  body('body').notEmpty().withMessage('body is required'),
  body('target').isIn(['all', 'groups', 'emails']).withMessage('target must be all, groups, or emails'),
  body('groupIds').if(body('target').equals('groups')).isArray({ min: 1 }).withMessage('groupIds required when target is groups'),
  body('groupIds.*').if(body('target').equals('groups')).isUUID().withMessage('Each groupId must be a valid UUID'),
  body('emails').if(body('target').equals('emails')).isArray({ min: 1 }).withMessage('emails required when target is emails'),
  body('emails.*').if(body('target').equals('emails')).isEmail().withMessage('Each email must be a valid email address'),
], validateMiddleware, pushBroadcast);

// Site notification
router.get('/site-notification', getSiteNotification);
router.put('/site-notification', [
  body('message').notEmpty().withMessage('message is required'),
  body('linkUrl').optional({ nullable: true, checkFalsy: true }).isURL().withMessage('linkUrl must be a valid URL'),
  body('linkText').optional({ nullable: true }).isString().trim(),
  body('isActive').optional().isBoolean(),
], validateMiddleware, upsertSiteNotification);
router.patch('/site-notification/toggle', toggleSiteNotification);

// Messages audit
router.get('/messages', listAllConversations);
router.get('/messages/:userId1/:userId2', getConversationThread);

module.exports = router;

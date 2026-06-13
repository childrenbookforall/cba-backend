const router = require('express').Router();
const authMiddleware = require('../middleware/auth.middleware');
const validateCursor = require('../middleware/validateCursor');
const { listMyGroups, getGroup, listGroupMembers } = require('../controllers/groups.controller');

router.use(authMiddleware);
router.use(validateCursor);

router.get('/', listMyGroups);
router.get('/:groupId/members', listGroupMembers);
router.get('/:groupId', getGroup);

module.exports = router;

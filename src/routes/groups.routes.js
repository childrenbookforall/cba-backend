const router = require('express').Router();
const authMiddleware = require('../middleware/auth.middleware');
const validateCursor = require('../middleware/validateCursor');
const { listMyGroups, getGroup, listGroupMembers, muteGroup, unmuteGroup } = require('../controllers/groups.controller');

router.use(authMiddleware);
router.use(validateCursor);

router.get('/', listMyGroups);
router.post('/:groupId/mute', muteGroup);
router.delete('/:groupId/mute', unmuteGroup);
router.get('/:groupId/members', listGroupMembers);
router.get('/:groupId', getGroup);

module.exports = router;

const router = require('express').Router();
const authMiddleware = require('../middleware/auth.middleware');
const { listMyGroups, getGroup } = require('../controllers/groups.controller');

router.use(authMiddleware);

router.get('/', listMyGroups);
router.get('/:groupId', getGroup);

module.exports = router;

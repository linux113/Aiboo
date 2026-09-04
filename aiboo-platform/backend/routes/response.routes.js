import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { responseActionSchema } from '../schemas/index.js';
import { audit } from '../utils/audit.js';
import { recordAction } from '../services/response.service.js';
import {
  isolateCtrl, blockCtrl, lockCtrl, elevateCtrl, autoRespondCtrl, responseLogCtrl
} from '../controllers/response.controller.js';

const router = express.Router();

// Every response action is high-impact → validated + audited.
const audited = (action) => (req, res, next) => {
  audit(req, action, { targetType: 'response', targetId: req.body?.target ?? req.body?.ip ?? req.body?.threatId, details: { body: req.body } });
  next();
};

router.post('/isolate', protect, authorize('admin', 'analyst'), validate({ body: responseActionSchema }), audited('response.isolate'), isolateCtrl);
router.post('/block',   protect, authorize('admin', 'analyst'), validate({ body: responseActionSchema }), audited('response.block'),   blockCtrl);
router.post('/lock',    protect, authorize('admin', 'analyst'), validate({ body: responseActionSchema }), audited('response.lock'),    lockCtrl);
router.post('/escalate', protect, authorize('admin', 'analyst'), audited('response.escalate'), elevateCtrl);
router.post('/auto',    protect, authorize('admin', 'analyst'), audited('response.auto'), autoRespondCtrl);
router.get('/log', protect, responseLogCtrl);

// ---- Dashboard orchestration quick-actions (previously 404) ----
const orchestration = (type, targetField) => async (req, res, next) => {
  try {
    const action = await recordAction(type, req.body?.[targetField], req.user?.id);
    res.status(201).json(action);
  } catch (err) { next(err); }
};

router.post('/lock-perimeter', protect, authorize('admin', 'analyst'), audited('response.lock_perimeter'), orchestration('lock_perimeter', 'zone'));
router.post('/quarantine',     protect, authorize('admin', 'analyst'), audited('response.quarantine'),     orchestration('quarantine', 'identity'));
router.post('/freeze-badge',   protect, authorize('admin', 'analyst'), audited('response.freeze_badge'),   orchestration('freeze_badge', 'badge'));
router.post('/throttle',       protect, authorize('admin', 'analyst'), audited('response.throttle'),       orchestration('throttle', 'segment'));
router.post('/war-room',       protect, authorize('admin', 'analyst'), audited('response.war_room'),       orchestration('war_room', 'room'));

export default router;

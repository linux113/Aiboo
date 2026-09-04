import express from 'express';
import {
  getThreats,
  postThreat,
  patchThreat,
  getThreat,
} from '../controllers/threat.controller.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { threatCreateSchema } from '../schemas/index.js';
import { audit } from '../utils/audit.js';

const router = express.Router();

router.get('/', protect, getThreats);
router.post('/', protect, authorize('admin', 'analyst'), validate({ body: threatCreateSchema }), (req, res, next) => {
  audit(req, 'threat.create', { targetType: 'threat', details: { severity: req.body.severity, source: req.body.source } });
  next();
}, postThreat);
router.patch('/:id', protect, authorize('admin', 'analyst'), (req, res, next) => {
  audit(req, 'threat.update', { targetType: 'threat', targetId: req.params.id, details: { patch: req.body } });
  next();
}, patchThreat);
router.get('/:id', protect, getThreat);

export default router;

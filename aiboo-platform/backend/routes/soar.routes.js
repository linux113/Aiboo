// backend/routes/soar.routes.js — SOAR playbook + incident API.
import express from 'express';
import { z } from 'zod';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../utils/audit.js';
import Playbook from '../models/Playbook.js';
import Incident from '../models/Incident.js';
import { approveIncident, rejectIncident } from '../services/soar.service.js';

const router = express.Router();

const actionTypes = z.enum([
  'isolate', 'block', 'lock', 'escalate', 'auto',
  'lock_perimeter', 'quarantine', 'freeze_badge', 'throttle', 'war_room',
]);

const playbookSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
  match: z.object({
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    typeContains: z.string().trim().max(80).optional().default(''),
    source: z.string().trim().max(40).optional().default(''),
  }),
  actions: z.array(z.object({
    type: actionTypes,
    target: z.string().trim().max(200).optional().default(''),
  })).min(1).max(10),
  mode: z.enum(['approval', 'auto']).optional().default('approval'),
  priority: z.number().int().min(0).max(1000).optional(),
});

// ---- Incidents ----
router.get('/incidents', protect, async (req, res, next) => {
  try {
    const { status, limit = 50, page = 1 } = req.query;
    const filter = status ? { status } : {};
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * lim;
    const [items, total] = await Promise.all([
      Incident.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim),
      Incident.countDocuments(filter),
    ]);
    res.json({ items, total, page: Number(page), limit: lim });
  } catch (err) { next(err); }
});

router.post('/incidents/:id/approve', protect, authorize('admin'), async (req, res, next) => {
  try { res.json(await approveIncident(req.params.id, req)); } catch (err) { next(err); }
});

router.post('/incidents/:id/reject', protect, authorize('admin'), async (req, res, next) => {
  try { res.json(await rejectIncident(req.params.id, req)); } catch (err) { next(err); }
});

// ---- Playbooks ----
router.get('/playbooks', protect, async (req, res, next) => {
  try { res.json(await Playbook.find({}).sort({ priority: 1 })); } catch (err) { next(err); }
});

router.post('/playbooks', protect, authorize('admin'), validate({ body: playbookSchema }), (req, res, next) => {
  audit(req, 'soar.playbook_create', { targetType: 'playbook', details: { name: req.body.name, mode: req.body.mode } });
  next();
}, async (req, res, next) => {
  try { res.status(201).json(await Playbook.create(req.body)); } catch (err) { next(err); }
});

router.patch('/playbooks/:id', protect, authorize('admin'), (req, res, next) => {
  audit(req, 'soar.playbook_update', { targetType: 'playbook', targetId: req.params.id });
  next();
}, async (req, res, next) => {
  try {
    const pb = await Playbook.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!pb) throw { statusCode: 404, message: 'Playbook not found' };
    res.json(pb);
  } catch (err) { next(err); }
});

router.delete('/playbooks/:id', protect, authorize('admin'), (req, res, next) => {
  audit(req, 'soar.playbook_delete', { targetType: 'playbook', targetId: req.params.id });
  next();
}, async (req, res, next) => {
  try {
    const pb = await Playbook.findByIdAndDelete(req.params.id);
    if (!pb) throw { statusCode: 404, message: 'Playbook not found' };
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;

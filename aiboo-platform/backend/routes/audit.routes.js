// backend/routes/audit.routes.js — audit trail read API (admin only).
import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import AuditLog from '../models/AuditLog.js';

const router = express.Router();

// GET /api/audit?action=detection.ack&email=&limit=50&page=1
router.get('/', protect, authorize('admin'), async (req, res, next) => {
  try {
    const { action, email, targetType, limit = 50, page = 1 } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (email) filter['actor.email'] = email;
    if (targetType) filter.targetType = targetType;

    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * lim;

    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(lim).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ items, total, page: Number(page), limit: lim });
  } catch (err) {
    next(err);
  }
});

export default router;

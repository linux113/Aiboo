// backend/routes/notification.routes.js — notification fabric admin API.
import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import {
  getChannelsStatus,
  getHistory,
  getQueueDepth,
  notifyCritical,
} from '../services/notification.service.js';

const router = express.Router();

// GET /api/notifications/channels — which channels are configured + health
router.get('/channels', protect, authorize('admin'), (req, res) => {
  res.json({
    channels: getChannelsStatus(),
    queueDepth: getQueueDepth(),
    historySize: getHistory(1000).length,
  });
});

// POST /api/notifications/test — force a test alert through every channel
router.post('/test', protect, authorize('admin'), (req, res) => {
  audit(req, 'notification.test', { targetType: 'notification' });
  notifyCritical(
    {
      type: 'notification.test',
      severity: 'critical',
      cameraName: 'console',
      message: `Manual test triggered by ${req.user?.email || 'admin'}`,
      timestamp: new Date().toISOString(),
    },
    { force: true }
  );
  res.status(202).json({ ok: true, message: 'Test alert queued to all configured channels' });
});

// GET /api/notifications/history — recent dispatch results (sent/failed)
router.get('/history', protect, authorize('admin'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json({ items: getHistory(limit) });
});

export default router;

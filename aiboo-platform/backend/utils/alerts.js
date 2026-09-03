// backend/utils/alerts.js — single funnel for critical alerts.
// Every `alert:critical` socket broadcast ALSO goes through the notification
// fabric (Slack / PagerDuty / webhook / SIEM CEF) — one call site, one truth.
import { getIO } from '../config/socket.js';
import { notifyCritical } from '../services/notification.service.js';
import logger from './logger.js';

export function emitCritical(payload) {
  try {
    getIO().emit('alert:critical', payload);
  } catch (err) {
    logger.error(`Socket emit failed (alert:critical): ${err.message}`);
  }
  notifyCritical(payload);
}

// backend/utils/audit.js — fire-and-forget audit trail writer.
// Never throws into the request path; failures are logged only.
// `req` may be null for background events (notification dead-letters etc.).
import AuditLog from '../models/AuditLog.js';
import logger from './logger.js';

export function audit(req, action, { targetType, targetId, details } = {}) {
  const r = req || {};
  const entry = {
    actor: {
      id: r.user?.id ?? null,
      email: r.user?.email ?? 'system',
      role: r.user?.role ?? null,
    },
    action,
    targetType,
    targetId: targetId ? String(targetId) : undefined,
    ip: r.ip,
    userAgent: r.headers?.['user-agent'],
    requestId: r.requestId,
    details: details ?? {},
  };

  AuditLog.create(entry).catch((err) => {
    logger.warn(`Audit write failed (${action}): ${err.message}`);
  });
}

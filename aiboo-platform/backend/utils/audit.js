// backend/utils/audit.js — fire-and-forget audit trail writer.
// Never throws into the request path; failures are logged only.
import AuditLog from '../models/AuditLog.js';
import logger from './logger.js';

export function audit(req, action, { targetType, targetId, details } = {}) {
  const entry = {
    actor: {
      id: req.user?.id ?? null,
      email: req.user?.email ?? 'anonymous',
      role: req.user?.role ?? null,
    },
    action,
    targetType,
    targetId: targetId ? String(targetId) : undefined,
    ip: req.ip,
    userAgent: req.headers?.['user-agent'],
    requestId: req.requestId,
    details: details ?? {},
  };

  AuditLog.create(entry).catch((err) => {
    logger.warn(`Audit write failed (${action}): ${err.message}`);
  });
}

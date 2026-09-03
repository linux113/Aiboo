// backend/middleware/requestId.js — correlation IDs for every request.
// Propagates an inbound X-Request-Id (from nginx/ingress) or mints a UUID,
// exposes it on req.requestId and echoes it in the response header.
import crypto from 'crypto';

const UUID_RE = /^[0-9a-fA-F-]{8,64}$/;

export function requestId(req, res, next) {
  const inbound = req.headers['x-request-id'];
  req.requestId = typeof inbound === 'string' && UUID_RE.test(inbound)
    ? inbound
    : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

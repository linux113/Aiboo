// backend/middleware/auth.js
import crypto from 'crypto';
import { verifyToken } from '../utils/tokens.js';
import { matchesAnyKey } from './security.js';
import { getRedis, redisSetJson } from '../config/redis.js';
import logger from '../utils/logger.js';

// ── Token revocation (dual store) ─────────────────────────────────
// Keys are sha256(token) — no raw tokens at rest. Redis (when REDIS_URL is
// set) makes revocation cluster-wide and restart-safe; the Map covers dev.

const tokenBlacklist = new Map(); // key -> expiry ms
const BLACKLIST_CHECK_INTERVAL = 60 * 1000;

function tokenKey(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function sweepMemory() {
  if (tokenBlacklist.size === 0) return;
  const now = Date.now();
  for (const [k, exp] of tokenBlacklist) if (now > exp) tokenBlacklist.delete(k);
}
setInterval(sweepMemory, BLACKLIST_CHECK_INTERVAL).unref();

async function isBlacklisted(token) {
  const key = tokenKey(token);
  const exp = tokenBlacklist.get(key);
  if (exp !== undefined) {
    if (Date.now() <= exp) return true;
    tokenBlacklist.delete(key);
  }
  const r = getRedis();
  if (r) {
    try {
      const ttl = await r.ttl(`revoked:${key}`);
      if (ttl > 0) {
        // re-cache locally for the remainder of the TTL
        tokenBlacklist.set(key, Date.now() + ttl * 1000);
        return true;
      }
    } catch (err) {
      logger.warn(`Blacklist redis check failed: ${err.message}`);
    }
  }
  return false;
}

export async function addToBlacklist(token) {  try {
    const decoded = jwtDecodeUnsafe(token);
    const key = tokenKey(token);
    // Revoke for the remaining validity of the token (default 24h for opaque).
    const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000;
    const ttlSec = Math.max(1, Math.floor((expMs - Date.now()) / 1000));
    tokenBlacklist.set(key, expMs);
    const r = getRedis();
    if (r) {
      try {
        await r.set(`revoked:${key}`, '1', 'EX', ttlSec);
      } catch (err) {
        logger.warn(`Blacklist redis write failed: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`addToBlacklist failed: ${err.message}`);
  }
}

function jwtDecodeUnsafe(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1] ?? '', 'base64url').toString());
  } catch {
    return null;
  }
}

// ── Middleware ────────────────────────────────────────────────────

export async function isBlacklistedPub(token) {
  return isBlacklisted(token);
}

export const protect = async (req, res, next) => {  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (await isBlacklisted(token)) {
      return res.status(401).json({ message: 'Token revoked' });
    }
    try {
      const decoded = verifyToken(token, 'access');
      req.user = decoded;
      req.accessToken = token;
      return next();
    } catch (err) {
      const msg = err.code === 'TYP_MISMATCH'
        ? err.message
        : 'Invalid or expired token';
      return res.status(401).json({ message: msg });
    }
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    // Timing-safe check against the API_KEYS allowlist (comma-separated env).
    if (matchesAnyKey(apiKey, process.env.API_KEYS)) {
      req.user = { id: null, role: 'service', email: 'service@aiboo' };
      return next();
    }
  }

  return res.status(401).json({ message: 'Not authorized, token missing' });
};

export const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden: insufficient role' });
  }
  next();
};

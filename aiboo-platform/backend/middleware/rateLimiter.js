// backend/middleware/rateLimiter.js
import rateLimit from 'express-rate-limit';
import { getRedis } from '../config/redis.js';
import logger from '../utils/logger.js';

// ──────────────────────────────────────────────
// Dual store: Redis when REDIS_URL is set (multi-instance safe), else an
// in-process fixed-window store. Store choice happens once at first use.
// ──────────────────────────────────────────────
class DualStore {
  constructor({ windowMs }) {
    this.windowMs = windowMs;
    this.memory = new Map(); // key -> { count, resetAt }
    this.r = null;
    this.rTried = false;
    this.prefix = 'rl:';
  }

  _redis() {
    if (!this.rTried) {
      this.r = getRedis();
      this.rTried = true;
      if (this.r) logger.info('Rate limiter using Redis store');
    }
    return this.r;
  }

  // Native v6.11/v7 store contract: increment(key) -> { totalHits, resetTime }
  async increment(key) {
    const redis = this._redis();
    if (redis) {
      try {
        const rKey = `${this.prefix}${key}`;
        const totalHits = await redis.incr(rKey);
        if (totalHits === 1) await redis.pexpire(rKey, this.windowMs);
        const ttlMs = await redis.pttl(rKey);
        return { totalHits, resetTime: new Date(Date.now() + Math.max(ttlMs, 0)) };
      } catch (err) {
        logger.warn(`Rate limiter redis error (${err.message}) — using memory`);
      }
    }
    // memory fixed-window
    const now = Date.now();
    let hit = this.memory.get(key);
    if (!hit || now > hit.resetAt) {
      hit = { count: 0, resetAt: now + this.windowMs };
      this.memory.set(key, hit);
      if (this.memory.size > 10_000) this._sweep(now);
    }
    hit.count += 1;
    return { totalHits: hit.count, resetTime: new Date(hit.resetAt) };
  }

  _sweep(now) {
    for (const [k, v] of this.memory) if (now > v.resetAt) this.memory.delete(k);
  }

  async decrement(key) {
    const hit = this.memory.get(key);
    if (hit && hit.count > 0) hit.count -= 1;
    const redis = this._redis();
    if (redis) { try { await redis.decr(`${this.prefix}${key}`); } catch { /* memory covers it */ } }
  }

  async resetKey(key) {
    this.memory.delete(key);
    const redis = this._redis();
    if (redis) { try { await redis.del(`${this.prefix}${key}`); } catch { /* noop */ } }
  }
}

// Rate limiting is ALWAYS on (dev included) — the old development skip meant
// tests never exercised limits and misconfigured prod went unprotected.
// Set RATE_LIMIT_DISABLED=true only for local debugging.
const disabled = () => process.env.RATE_LIMIT_DISABLED === 'true';

const dualStore = (windowMs) => new DualStore({ windowMs });

// ──────────────────────────────────────────────
// Auth limiter – stricter (20 attempts per 15 min)
// ──────────────────────────────────────────────
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    store: dualStore(15 * 60 * 1000),
    message: { message: 'Too many auth attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => disabled(),
});

// ──────────────────────────────────────────────
// API limiter – for general API endpoints
// ──────────────────────────────────────────────
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    store: dualStore(15 * 60 * 1000),
    message: { message: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => disabled() || req.path === '/health' || req.path === '/',
});

// ──────────────────────────────────────────────
// Agent-specific limiter – higher limit for agents
// ──────────────────────────────────────────────
export const agentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    store: dualStore(60 * 1000),
    message: { message: 'Too many agent requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => disabled(),
});

// ──────────────────────────────────────────────
// Per-IP limiter – for agent polling commands
// ──────────────────────────────────────────────
export const commandLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    store: dualStore(60 * 1000),
    message: { message: 'Too many command requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => disabled(),
});

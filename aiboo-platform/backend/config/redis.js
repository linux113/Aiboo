// backend/config/redis.js
// Optional Redis. If REDIS_URL is set, an ioredis client is created and
// shared by the token blacklist + rate limiters (multi-instance safe).
// Without REDIS_URL everything transparently falls back to in-process memory
// (single-instance dev mode) — no hard dependency.
import Redis from 'ioredis';
import logger from '../utils/logger.js';

let client = null;
let attempted = false;

export function getRedis() {
  if (attempted) return client;
  attempted = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.info('REDIS_URL not set — using in-memory stores (single instance only)');
    return null;
  }

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 500, 5000),
      enableOfflineQueue: false,
    });
    client.on('error', (err) => logger.error(`Redis error: ${err.message}`));
    client.on('connect', () => logger.info('Redis connected'));
    logger.info('Redis client created');
  } catch (err) {
    logger.error(`Redis init failed (${err.message}) — falling back to memory`);
    client = null;
  }
  return client;
}

/** Get a JSON value; returns null on miss/absence of redis. */
export async function redisGetJson(key) {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Set a JSON value with TTL seconds; no-op without redis. */
export async function redisSetJson(key, value, ttlSeconds) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.floor(ttlSeconds)));
  } catch (err) {
    logger.warn(`Redis SET failed: ${err.message}`);
  }
}

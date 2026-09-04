// backend/middleware/security.js
// Shared security helpers: constant-time secret comparison + boot-time checks.
import crypto from 'crypto';

/**
 * Constant-time string comparison — prevents timing attacks on API keys.
 * Returns true iff both strings are non-empty and equal.
 */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length === 0 || bufB.length === 0) return false;
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Check a provided key against a comma-separated env list, timing-safe. */
export function matchesAnyKey(provided, envList) {
  if (!provided) return false;
  const keys = String(envList || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return keys.some((k) => safeEqual(provided, k));
}

const KNOWN_INSECURE_SECRETS = new Set([
  'cv-ingest-key-change-me',
  'dev-key-change-in-production',
  'internal-dev-key',
  'changeme-cv-token',
  'changeme-default-token-change-in-production',
  'sk-service-key-1',
  'sk-service-key-2',
  // default secret shipped in .env.example
  'ab7f3e91c8d24b5a6f0e927c1d3a8b4e5f6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e',
]);

/**
 * Fail fast in production if any well-known default secret is still in use.
 * Industry baseline: a boot with leaked/placeholder credentials must never serve traffic.
 */
export function assertProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') return;

  const failures = [];
  const jwt = process.env.JWT_SECRET || '';
  if (!jwt || jwt.length < 32) failures.push('JWT_SECRET missing or shorter than 32 chars');
  else if (KNOWN_INSECURE_SECRETS.has(jwt)) failures.push('JWT_SECRET is a known default — rotate it');

  const agentKey = process.env.AGENT_API_KEY || '';
  if (!agentKey || KNOWN_INSECURE_SECRETS.has(agentKey)) {
    failures.push('AGENT_API_KEY missing or set to a development default');
  }

  const apiKeys = (process.env.API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) failures.push('API_KEYS not configured (service-to-service auth disabled)');
  else if (apiKeys.some((k) => KNOWN_INSECURE_SECRETS.has(k))) {
    failures.push('API_KEYS contains placeholder values (sk-service-key-1/2)');
  }

  const cvKey = process.env.CV_INGEST_KEY || '';
  if (!cvKey || KNOWN_INSECURE_SECRETS.has(cvKey)) {
    failures.push('CV_INGEST_KEY missing or default — camera detections endpoint would be unauthenticated');
  }

  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.error('\n================================ PRODUCTION BOOT ABORTED ================================');
    // eslint-disable-next-line no-console
    console.error('Insecure configuration detected:\n  - ' + failures.join('\n  - '));
    // eslint-disable-next-line no-console
    console.error('Generate secrets with: openssl rand -hex 32');
    // eslint-disable-next-line no-console
    console.error('==========================================================================================\n');
    process.exit(1);
  }
}

/**
 * Service authentication for machine-to-machine ingest (e.g. CV service
 * posting detections). Accepts an X-API-Key header matching CV_INGEST_KEY
 * (timing-safe). If CV_INGEST_KEY is not configured the request is allowed
 * with a loud one-time warning — local development keeps working, but a
 * misconfigured production deployment becomes instantly visible.
 */
let warnedUnprotected = false;
export function serviceAuth(req, res, next) {
  const ingestKey = process.env.CV_INGEST_KEY || '';

  if (!ingestKey) {
    if (!warnedUnprotected) {
      // eslint-disable-next-line no-console
      console.warn(
        'CV_INGEST_KEY not set - POST /api/cameras/detections is UNAUTHENTICATED. ' +
          'Set CV_INGEST_KEY in production to require service authentication.'
      );
      warnedUnprotected = true;
    }
    return next();
  }

  const provided = req.headers['x-api-key'] || '';
  if (safeEqual(provided, ingestKey)) {
    req.user = { id: null, role: 'service', email: 'cv-service@aiboo' };
    return next();
  }

  return res.status(401).json({ message: 'Invalid or missing service key (X-API-Key)' });
}


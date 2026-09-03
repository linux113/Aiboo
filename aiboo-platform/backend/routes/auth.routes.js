import express from 'express';
import { registerCtrl, loginCtrl, meCtrl } from '../controllers/auth.controller.js';
import { protect, addToBlacklist, isBlacklistedPub } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import { registerSchema, loginSchema } from '../schemas/index.js';
import { audit } from '../utils/audit.js';
import logger from '../utils/logger.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from '../utils/tokens.js';

const router = express.Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), registerCtrl);

router.post('/login', authLimiter, validate({ body: loginSchema }), loginCtrl);

router.get('/me', protect, meCtrl);

// ---- Token lifecycle (industry pattern: short access + rotating refresh) ----

// POST /api/auth/refresh — reads the httpOnly refresh cookie, rotates it,
// returns a fresh access token. Old refresh token is revoked (single use).
router.post('/refresh', authLimiter, async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) return res.status(401).json({ message: 'No refresh token' });

  // Reject rotated/revoked refresh tokens (single-use enforcement).
  if (await isBlacklistedPub(raw)) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return res.status(401).json({ message: 'Refresh token revoked' });
  }

  try {
    const decoded = verifyToken(raw, 'refresh');
    const freshAccess = signAccessToken(decoded);
    const freshRefresh = signRefreshToken(decoded);
    await addToBlacklist(raw); // rotate: old refresh dies now
    res.cookie(REFRESH_COOKIE, freshRefresh, refreshCookieOptions());
    res.json({ token: freshAccess, user: { id: decoded.id, email: decoded.email, name: decoded.name, role: decoded.role } });
  } catch (err) {
    // Invalid/expired/replayed refresh: clear the cookie, force re-login.
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    const msg = err.code === 'TYP_MISMATCH' ? err.message : 'Invalid or expired refresh token';
    return res.status(401).json({ message: msg });
  }
});

// POST /api/auth/logout — revokes the current access token and refresh cookie.
router.post('/logout', protect, async (req, res) => {
  try {
    await addToBlacklist(req.accessToken);
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) {
      try {
        const decoded = verifyToken(raw, 'refresh');
        if (decoded) await addToBlacklist(raw);
      } catch { /* cookie already invalid — nothing to revoke */ }
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    audit(req, 'auth.logout', { targetType: 'user', targetId: req.user?.id });
    res.json({ ok: true });
  } catch (err) {
    logger.error(`Logout failed: ${err.message}`);
    res.status(500).json({ message: 'Logout failed' });
  }
});

export default router;

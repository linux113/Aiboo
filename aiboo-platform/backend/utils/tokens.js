// backend/utils/tokens.js
// JWT pair issuance: short-lived ACCESS token + rotating REFRESH token.
//  - access : Bearer, typ:'access',  JWT_ACCESS_TTL  (default '1h')
//  - refresh : httpOnly cookie only, typ:'refresh', JWT_REFRESH_TTL (default '7d')
// Refresh tokens are single-use (rotated on every /refresh; the previous one
// is revoked). Never store refresh tokens in localStorage.
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '1h';
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || '7d';

export const REFRESH_COOKIE = 'aiboo_refresh';

const basePayload = (user) => ({
  id: user.id ?? user._id?.toString(),
  email: user.email,
  name: user.name,
  role: user.role,
});

export function signAccessToken(user) {
  return jwt.sign({ ...basePayload(user), typ: 'access' }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

export function signRefreshToken(user) {
  // jti guarantees every refresh token is unique — without it, a refresh in
  // the same second as the previous sign produces a BYTE-IDENTICAL token,
  // making rotation a silent no-op (and then blacklisting itself).
  return jwt.sign(
    { ...basePayload(user), typ: 'refresh', jti: crypto.randomUUID() },
    process.env.JWT_SECRET,
    { expiresIn: REFRESH_TTL }
  );
}

/**
 * Verify a token and enforce its expected type.
 * Legacy tokens (signed before typ existed) pass the 'access' check.
 */
export function verifyToken(token, expectedTyp = 'access') {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (expectedTyp === 'access' && decoded.typ === 'refresh') {
    const err = new Error('Refresh token cannot be used as an access token');
    err.code = 'TYP_MISMATCH';
    throw err;
  }
  if (expectedTyp === 'refresh' && decoded.typ !== 'refresh') {
    const err = new Error('Not a refresh token');
    err.code = 'TYP_MISMATCH';
    throw err;
  }
  return decoded;
}

/** Cookie options for the refresh token. */
export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',          // SPA is same-origin via nginx proxy
    path: '/api/auth',        // cookie is only sent to auth endpoints
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

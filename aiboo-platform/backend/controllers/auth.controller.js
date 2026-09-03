import { register, login, getMe } from '../services/auth.service.js';
import { audit } from '../utils/audit.js';
import {
  signAccessToken,
  signRefreshToken,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from '../utils/tokens.js';

export const registerCtrl = async (req, res, next) => {
  try {
    const { token, user } = await register(req.body);
    const access = signAccessToken(user);
    res.cookie(REFRESH_COOKIE, signRefreshToken(user), refreshCookieOptions());
    audit(req, 'auth.register', { targetType: 'user', targetId: user?._id ?? user?.id, details: { email: user?.email } });
    res.status(201).json({ token: access, user });
  } catch (err) { next(err); }
};

export const loginCtrl = async (req, res, next) => {
  try {
    const { token, user } = await login(req.body);
    const access = signAccessToken(user);
    res.cookie(REFRESH_COOKIE, signRefreshToken(user), refreshCookieOptions());
    audit(req, 'auth.login', { targetType: 'user', targetId: user?._id ?? user?.id, details: { email: user?.email, role: user?.role } });
    res.json({ token: access, user });
  } catch (err) {
    audit(req, 'auth.login_failed', { targetType: 'user', details: { email: req.body?.email, reason: err.message } });
    next(err);
  }
};

export const meCtrl = async (req, res, next) => {
  try {
    const user = await getMe(req.user.id);
    res.json(user);
  } catch (err) { next(err); }
};

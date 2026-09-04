// backend/routes/intel.routes.js — threat-intel lookup API.
import express from 'express';
import { z } from 'zod';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../utils/audit.js';
import { intelStatus, lookupIp, lookupHash } from '../services/intel.service.js';

const router = express.Router();

const lookupQuery = z
  .object({
    ip: z.string().trim().regex(/^\d{1,3}(\.\d{1,3}){3}$/, 'invalid IPv4').optional(),
    hash: z.string().trim().regex(/^[0-9a-f]{32}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$/i, 'md5/sha1/sha256 only').optional(),
  })
  .refine((q) => Boolean(q.ip ?? q.hash), { message: 'ip or hash is required' })
  .refine((q) => !(q.ip && q.hash), { message: 'pass ip or hash, not both' });

// GET /api/intel/status — which sources are configured
router.get('/status', protect, (req, res) => {
  res.json(intelStatus());
});

// GET /api/intel/lookup?ip=8.8.8.8 | ?hash=<md5/sha1/sha256>
router.get('/lookup', protect, authorize('admin', 'analyst'), validate({ query: lookupQuery }), async (req, res, next) => {
  try {
    const { ip, hash } = req.validatedQuery;
    audit(req, 'intel.lookup', { targetType: 'indicator', targetId: ip ?? hash });
    const result = ip ? await lookupIp(ip) : await lookupHash(hash.toLowerCase());
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;

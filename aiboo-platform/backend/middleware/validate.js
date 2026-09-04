// backend/middleware/validate.js
// Zod-powered request validation. Usage:
//   router.post('/', validate({ body: schemas.x }), handler)
// Coerces + strips unknown keys (via .strict() where defined) and returns
// a clean 400 with field-level details instead of leaking Mongo errors.
import { z } from 'zod';

const firstMessage = (error) => {
  const issue = error.issues?.[0];
  if (!issue) return 'Invalid request';
  const path = issue.path?.join('.') || 'body';
  return `${path}: ${issue.message}`;
};

export const validate = ({ body, query, params } = {}) => (req, res, next) => {
  try {
    if (body) req.body = body.parse(req.body ?? {});
    if (query) req.validatedQuery = query.parse(req.query ?? {});
    if (params) req.validatedParams = params.parse(req.params ?? {});
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: firstMessage(error),
        validation: true,
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    next(error);
  }
};

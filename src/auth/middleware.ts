import type { RequestHandler } from 'express';

/** Gate for everything past the auth routes. Registered once with `app.use`,
 * so every route declared after it requires a session — including any added
 * later, which is the point: opting in is the default. */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Login required.' });
    return;
  }
  next();
};

import type { NextFunction, Request, Response } from 'express';

export function sessionExpirationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const session = req.session;

  if (session && !session.rolling && session.absoluteExpiresAt) {
    session.cookie.maxAge = Math.max(0, session.absoluteExpiresAt - Date.now());
  }

  next();
}

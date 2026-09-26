import { SESSION_ACTIVITY_INTERVAL_MS } from '@modules/sessions/sessions.constants';
import { SessionsService } from '@modules/sessions/sessions.service';
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

export function sessionActivityMiddleware(sessionsService: SessionsService) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const lastSeenAt = req.session?.lastSeenAt ?? 0;

    if (!req.user || Date.now() - lastSeenAt < SESSION_ACTIVITY_INTERVAL_MS)
      return next();

    sessionsService.track(req).then(() => next(), next);
  };
}

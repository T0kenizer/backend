import { wrap } from '@mikro-orm/core';
import {
  AUTH_COOKIE_NAME,
  REMEMBER_ME_SESSION_TIMEOUT_MS,
  SESSION_TIMEOUT_MS,
} from '@modules/sessions/sessions.constants';
import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

@Injectable()
export class SessionsService {
  public create(req: Request, rememberMe: boolean = false) {
    return new Promise((resolve, reject) => {
      req.login(req.user, (error: Error) => {
        if (error) return reject(error);

        const expiresIn = rememberMe
          ? REMEMBER_ME_SESSION_TIMEOUT_MS
          : SESSION_TIMEOUT_MS;

        req.session.cookie.maxAge = expiresIn;

        resolve({
          user: wrap(req.user).toObject(),
          expiresAt: new Date(Date.now() + expiresIn),
          expiresIn,
        });
      });
    });
  }

  public retrieve(req: Request) {
    const expiresIn = req.session.cookie.maxAge ?? SESSION_TIMEOUT_MS;

    return {
      user: req.user!,
      expiresAt: new Date(Date.now() + expiresIn),
      expiresIn,
    };
  }

  public delete(req: Request, res: Response) {
    return new Promise<void>((resolve, reject) => {
      req.logout((error: Error) => {
        if (error) return reject(error);

        req.session.destroy((error: Error) => {
          if (error) return reject(error);

          res.clearCookie(AUTH_COOKIE_NAME);
          resolve();
        });
      });
    });
  }
}

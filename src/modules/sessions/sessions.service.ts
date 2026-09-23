import { wrap } from '@mikro-orm/core';
import {
  AUTH_COOKIE_NAME,
  EXTENDED_SESSION_TIMEOUT_MS,
  SESSION_TIMEOUT_MS,
} from '@modules/sessions/sessions.constants';
import { UsersService } from '@modules/users/users.service';
import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

@Injectable()
export class SessionsService {
  constructor(private readonly usersService: UsersService) {}

  public async create(req: Request, stayConnected: boolean = false) {
    const user = req.user;
    if (!user) throw new Error('No authenticated user on request');

    const avatarUrl = await this.usersService.buildAvatarUrl(user);

    return new Promise((resolve, reject) => {
      req.login(user, (error: Error) => {
        if (error) return reject(error);

        const expiresIn = stayConnected
          ? EXTENDED_SESSION_TIMEOUT_MS
          : SESSION_TIMEOUT_MS;

        req.session.cookie.maxAge = expiresIn;
        req.session.rolling = stayConnected;

        if (!stayConnected)
          req.session.absoluteExpiresAt = Date.now() + expiresIn;
        else delete req.session.absoluteExpiresAt;

        resolve({
          user: { ...wrap(user).toObject(), avatarUrl },
          expiresAt: new Date(Date.now() + expiresIn),
          expiresIn,
        });
      });
    });
  }

  public async retrieve(req: Request) {
    const expiresIn = Math.max(
      0,
      req.session.cookie.maxAge ?? SESSION_TIMEOUT_MS,
    );

    return {
      user: {
        ...wrap(req.user!).toObject(),
        avatarUrl: await this.usersService.buildAvatarUrl(req.user!),
      },
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

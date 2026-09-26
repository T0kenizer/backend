import { wrap } from '@mikro-orm/core';
import { RedisService } from '@modules/redis/services/redis.service';
import {
  AUTH_COOKIE_NAME,
  EXTENDED_SESSION_TIMEOUT_MS,
  SESSION_KEY_PREFIX,
  SESSION_TIMEOUT_MS,
  USER_SESSIONS_KEY_PREFIX,
} from '@modules/sessions/sessions.constants';
import { UsersService } from '@modules/users/users.service';
import { Injectable } from '@nestjs/common';
import { DeviceType, UserSession } from '@tokenizer/shared/types';
import Bowser from 'bowser';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import type { SessionData } from 'express-session';

type StoredSession = Omit<SessionData, 'cookie'> & {
  cookie: { expires?: Nullish<string | Date> };
  passport?: { user?: string };
};

const DEVICE_TYPES: Record<string, DeviceType> = {
  desktop: DeviceType.Desktop,
  mobile: DeviceType.Mobile,
  tablet: DeviceType.Tablet,
};

const UNKNOWN_COUNTRIES = ['XX', 'T1'];

@Injectable()
export class SessionsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
  ) {}

  public async create(req: Request, stayConnected: boolean = false) {
    const user = req.user;
    if (!user) throw new Error('No authenticated user on request');

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

        this.track(req)
          .then(() => this.retrieve(req))
          .then(resolve, reject);
      });
    });
  }

  public async retrieve(req: Request) {
    const user = req.user!;

    return {
      ...this.serialize(req.sessionID, req.session, req),
      user: {
        ...wrap(user).toObject(),
        avatarUrl: await this.usersService.buildAvatarUrl(user),
      },
    };
  }

  public async delete(req: Request, res: Response) {
    const { user, sessionID } = req;

    if (user)
      await this.redisService.client.sRem(
        USER_SESSIONS_KEY_PREFIX + user.uuid,
        sessionID,
      );

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

  public async list(uuid: string, req: Request): Promise<UserSession[]> {
    const { client } = this.redisService;
    const key = USER_SESSIONS_KEY_PREFIX + uuid;

    const sessionIds = await client.sMembers(key);
    if (!sessionIds.length) return [];

    const payloads = await client.mGet(
      sessionIds.map((sessionId) => SESSION_KEY_PREFIX + sessionId),
    );

    const sessions: UserSession[] = [];
    const expired: string[] = [];

    sessionIds.forEach((sessionId, index) => {
      const payload = payloads[index];
      const session = payload ? (JSON.parse(payload) as StoredSession) : null;

      if (session?.passport?.user !== uuid) expired.push(sessionId);
      else sessions.push(this.serialize(sessionId, session, req));
    });

    if (expired.length) await client.sRem(key, expired);

    return sessions.sort(
      (a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
    );
  }

  public async track(req: Request): Promise<void> {
    const { user, session } = req;
    if (!user) return;

    const now = Date.now();

    session.createdAt ??= now;
    session.lastSeenAt = now;
    session.userAgent = req.get('user-agent');
    session.ip = req.ip?.replace(/^::ffff:/, '');
    session.location = SessionsService.locate(req);

    const key = USER_SESSIONS_KEY_PREFIX + user.uuid;
    await this.redisService.client
      .multi()
      .sAdd(key, req.sessionID)
      .expire(key, EXTENDED_SESSION_TIMEOUT_MS / 1000)
      .exec();
  }

  private serialize(
    sessionId: string,
    session: StoredSession,
    req: Request,
  ): UserSession {
    const now = Date.now();
    const expiresAt = session.cookie.expires
      ? new Date(session.cookie.expires)
      : null;

    return {
      id: createHash('sha256').update(sessionId).digest('base64url'),
      current: sessionId === req.sessionID,
      createdAt: new Date(session.createdAt ?? now),
      lastSeenAt: new Date(session.lastSeenAt ?? now),
      expiresAt,
      expiresIn: expiresAt ? Math.max(0, expiresAt.getTime() - now) : null,
      ip: session.ip ?? null,
      device: SessionsService.describeDevice(session.userAgent),
      location: session.location ?? null,
    };
  }

  private static describeDevice(userAgent: Optional<string>) {
    if (!userAgent)
      return { type: DeviceType.Unknown, os: null, browser: null };

    const { platform, os, browser } = Bowser.parse(userAgent);

    return {
      type: DEVICE_TYPES[platform.type ?? ''] ?? DeviceType.Unknown,
      os:
        [os.name, os.versionName ?? os.version].filter(Boolean).join(' ') ||
        null,
      browser:
        [browser.name, browser.version?.split('.')[0]]
          .filter(Boolean)
          .join(' ') || null,
    };
  }

  private static locate(req: Request): SessionData['location'] {
    const country = req.get('cf-ipcountry')?.toUpperCase();

    const location = {
      city: req.get('cf-ipcity') || null,
      region: req.get('cf-region') || null,
      country: country && !UNKNOWN_COUNTRIES.includes(country) ? country : null,
    };

    return Object.values(location).some(Boolean) ? location : undefined;
  }
}

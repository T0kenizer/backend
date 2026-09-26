import { RedisService } from '@modules/redis/services/redis.service';
import {
  SESSION_KEY_PREFIX,
  USER_SESSIONS_KEY_PREFIX,
} from '@modules/sessions/sessions.constants';
import { SessionsService } from '@modules/sessions/sessions.service';
import { UsersService } from '@modules/users/users.service';
import { DeviceType } from '@tokenizer/shared/types';
import type { Request } from 'express';

const USER_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function build(store: Record<string, string> = {}, index: string[] = []) {
  const multi = {
    sAdd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
  const client = {
    sMembers: jest.fn().mockResolvedValue(index),
    mGet: jest.fn((keys: string[]) =>
      Promise.resolve(keys.map((key) => store[key] ?? null)),
    ),
    sRem: jest.fn().mockResolvedValue(1),
    multi: jest.fn(() => multi),
  };
  const service = new SessionsService(
    {} as UsersService,
    { client } as unknown as RedisService,
  );
  return { service, client, multi };
}

const stored = (data: Record<string, unknown>) =>
  JSON.stringify({ cookie: { expires: null }, ...data });

describe('SessionsService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('list', () => {
    it('describes each live session, most recently active first', async () => {
      const { service } = build(
        {
          [`${SESSION_KEY_PREFIX}phone`]: stored({
            passport: { user: USER_UUID },
            createdAt: 1_000,
            lastSeenAt: 5_000,
            userAgent: IPHONE_UA,
            ip: '203.0.113.7',
            location: { city: 'Lyon', region: 'Rhône', country: 'FR' },
          }),
          [`${SESSION_KEY_PREFIX}laptop`]: stored({
            passport: { user: USER_UUID },
            createdAt: 2_000,
            lastSeenAt: 9_000,
            userAgent: WINDOWS_UA,
            cookie: { expires: '2026-10-01T00:00:00.000Z' },
          }),
        },
        ['phone', 'laptop'],
      );

      const sessions = await service.list(USER_UUID, {
        sessionID: 'laptop',
      } as Request);

      expect(sessions.map((session) => session.current)).toEqual([true, false]);
      expect(sessions[0]).toMatchObject({
        lastSeenAt: new Date(9_000),
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
        device: { type: DeviceType.Desktop, os: 'Windows 10' },
        location: null,
      });
      expect(sessions[0].device.browser).toBe('Chrome 124');
      expect(sessions[1]).toMatchObject({
        createdAt: new Date(1_000),
        ip: '203.0.113.7',
        device: { type: DeviceType.Mobile, browser: 'Safari 17' },
        location: { city: 'Lyon', region: 'Rhône', country: 'FR' },
      });
    });

    it('counts down to the expiry, and leaves it null when there is none', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 30));
      const { service } = build(
        {
          [`${SESSION_KEY_PREFIX}dated`]: stored({
            passport: { user: USER_UUID },
            lastSeenAt: 2_000,
            cookie: { expires: '2026-10-01T00:00:00.000Z' },
          }),
          [`${SESSION_KEY_PREFIX}undated`]: stored({
            passport: { user: USER_UUID },
            lastSeenAt: 1_000,
          }),
        },
        ['dated', 'undated'],
      );

      const [dated, undated] = await service.list(USER_UUID, {} as Request);

      expect(dated.expiresIn).toBe(1000 * 60 * 60 * 24);
      expect(undated).toMatchObject({ expiresAt: null, expiresIn: null });
    });

    it('never exposes the raw session id', async () => {
      const { service } = build(
        {
          [`${SESSION_KEY_PREFIX}secret-sid`]: stored({
            passport: { user: USER_UUID },
          }),
        },
        ['secret-sid'],
      );

      const [session] = await service.list(USER_UUID, {} as Request);

      // The raw id plus the cookie secret is the session: leaking it would let
      // whoever reads the listing forge the cookie.
      expect(session.id).not.toContain('secret-sid');
      expect(session.id).toMatch(/^[\w-]{43}$/);
    });

    it('prunes the ids of expired sessions from the index', async () => {
      const { service, client } = build(
        {
          [`${SESSION_KEY_PREFIX}alive`]: stored({
            passport: { user: USER_UUID },
          }),
        },
        ['alive', 'expired'],
      );

      const sessions = await service.list(USER_UUID, {} as Request);

      expect(sessions).toHaveLength(1);
      expect(client.sRem).toHaveBeenCalledWith(
        `${USER_SESSIONS_KEY_PREFIX}${USER_UUID}`,
        ['expired'],
      );
    });

    it('drops a session that now belongs to somebody else', async () => {
      const { service, client } = build(
        {
          [`${SESSION_KEY_PREFIX}reused`]: stored({
            passport: { user: OTHER_UUID },
          }),
        },
        ['reused'],
      );

      await expect(service.list(USER_UUID, {} as Request)).resolves.toEqual([]);
      expect(client.sRem).toHaveBeenCalledWith(
        `${USER_SESSIONS_KEY_PREFIX}${USER_UUID}`,
        ['reused'],
      );
    });

    it('skips the store entirely when the user has no session', async () => {
      const { service, client } = build();

      await expect(service.list(USER_UUID, {} as Request)).resolves.toEqual([]);
      expect(client.mGet).not.toHaveBeenCalled();
    });
  });

  describe('track', () => {
    const request = (headers: Record<string, string>) =>
      ({
        user: { uuid: USER_UUID },
        session: {},
        sessionID: 'sid',
        ip: '::ffff:198.51.100.4',
        get: (name: string) => headers[name.toLowerCase()],
      }) as unknown as Request;

    it('records the device and location, and indexes the session', async () => {
      const { service, multi } = build();
      const req = request({
        'user-agent': IPHONE_UA,
        'cf-ipcountry': 'fr',
        'cf-ipcity': 'Lyon',
      });

      await service.track(req);

      expect(req.session).toMatchObject({
        userAgent: IPHONE_UA,
        ip: '198.51.100.4',
        location: { city: 'Lyon', region: null, country: 'FR' },
      });
      expect(multi.sAdd).toHaveBeenCalledWith(
        `${USER_SESSIONS_KEY_PREFIX}${USER_UUID}`,
        'sid',
      );
    });

    it('keeps the opening date across later activity', async () => {
      const { service } = build();
      const req = request({});
      req.session.createdAt = 1_000;

      await service.track(req);

      expect(req.session.createdAt).toBe(1_000);
      expect(req.session.lastSeenAt).toBeGreaterThan(1_000);
    });

    it("ignores Cloudflare's placeholder countries", async () => {
      const { service } = build();
      const req = request({ 'cf-ipcountry': 'T1' });

      await service.track(req);

      expect(req.session.location).toBeUndefined();
    });
  });
});

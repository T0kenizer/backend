import { GameCodesService } from '@modules/game-core/game-codes.service';
import * as Constants from '@modules/game-core/game-core.constants';
import type { RedisService } from '@modules/redis/services/redis.service';
import { JOIN_CODE_REGEX } from '@tokenizer/shared/constants/games.constants';

const GAME_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

/**
 * A Redis stand-in that honours the semantics the service depends on — most of
 * all that `SET NX` fails on an existing key, which is the whole mechanism
 * behind collision-free code minting.
 */
function fakeRedis() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();

  const multiOps: { expire: jest.Mock; del: jest.Mock; exec: jest.Mock } = {
    expire: jest.fn(),
    del: jest.fn(),
    exec: jest.fn(),
  };

  const client = {
    store,
    ttls,
    set: jest.fn(
      (
        key: string,
        value: string,
        opts?: { condition?: string; expiration?: { value: number } },
      ) => {
        if (opts?.condition === 'NX' && store.has(key)) return null;
        store.set(key, value);
        if (opts?.expiration) ttls.set(key, opts.expiration.value);
        return 'OK';
      },
    ),
    get: jest.fn((key: string) => store.get(key) ?? null),
    multi: jest.fn(() => {
      const chain = {
        expire: (key: string, seconds: number) => {
          multiOps.expire(key, seconds);
          if (store.has(key)) ttls.set(key, seconds);
          return chain;
        },
        del: (key: string) => {
          multiOps.del(key);
          store.delete(key);
          ttls.delete(key);
          return chain;
        },
        exec: () => {
          multiOps.exec();
          return Promise.resolve([]);
        },
      };
      return chain;
    }),
  };

  return { client, multiOps };
}

function build() {
  const { client, multiOps } = fakeRedis();
  const service = new GameCodesService({
    client,
  } as unknown as RedisService);
  return { service, client, multiOps };
}

describe('GameCodesService', () => {
  it('mints a 6-digit code and maps it both ways under a TTL', async () => {
    const { service, client } = build();

    const code = await service.issue(GAME_UUID);

    expect(code).toMatch(JOIN_CODE_REGEX);
    expect(await service.resolve(code)).toBe(GAME_UUID);
    expect(await service.codeFor(GAME_UUID)).toBe(code);
    expect(client.ttls.get(`game_code:${code}`)).toBe(
      Constants.JOIN_CODE_TTL_SECONDS,
    );
    expect(client.ttls.get(`game_uuid:${GAME_UUID}`)).toBe(
      Constants.JOIN_CODE_TTL_SECONDS,
    );
  });

  it('re-draws on a collision instead of stealing the taken code', async () => {
    const { service } = build();
    // Force the draw: the second session lands on the first one's code before
    // finally drawing a free one.
    const draws = jest
      .spyOn(service as unknown as { drawCode: () => string }, 'drawCode')
      .mockReturnValueOnce('424242')
      .mockReturnValueOnce('424242')
      .mockReturnValueOnce('999111');

    const taken = await service.issue(OTHER_UUID);
    const code = await service.issue(GAME_UUID);

    expect(taken).toBe('424242');
    expect(code).toBe('999111');
    expect(draws).toHaveBeenCalledTimes(3);
    // The incumbent keeps its mapping: NX refused the colliding write.
    expect(await service.resolve('424242')).toBe(OTHER_UUID);
    expect(await service.resolve('999111')).toBe(GAME_UUID);

    draws.mockRestore();
  });

  it('always mints exactly six digits, low draws padded', async () => {
    const { service } = build();

    // A draw of 42 must read "000042", not "42": the client validates the
    // shape, and a short code would be rejected before it ever resolved.
    for (let i = 0; i < 200; i++) {
      expect(await service.issue(`${GAME_UUID}-${i}`)).toMatch(JOIN_CODE_REGEX);
    }
  });

  it('claims each draw with SET NX so two minters cannot both win a code', async () => {
    const { service, client } = build();

    await service.issue(GAME_UUID);

    const codeWrite = client.set.mock.calls.find(([key]) =>
      String(key).startsWith('game_code:'),
    );
    expect(codeWrite?.[2]).toMatchObject({
      condition: 'NX',
      expiration: { type: 'EX', value: Constants.JOIN_CODE_TTL_SECONDS },
    });
  });

  it('gives up rather than loop forever when every draw collides', async () => {
    const { service, client } = build();
    // Every NX write fails: the space is saturated.
    client.set.mockImplementation((key: string) =>
      String(key).startsWith('game_code:') ? null : 'OK',
    );

    await expect(service.issue(GAME_UUID)).rejects.toThrow(
      'Failed to generate a unique join code',
    );
    expect(client.set).toHaveBeenCalledTimes(Constants.JOIN_CODE_MAX_ATTEMPTS);
  });

  it('cannot tell an expired code from one that never existed', async () => {
    const { service, client } = build();
    const code = await service.issue(GAME_UUID);

    // Expiry, as Redis would do it: the key is simply gone.
    client.store.delete(`game_code:${code}`);

    expect(await service.resolve(code)).toBeNull();
    expect(await service.resolve('000000')).toBeNull();
  });

  it('slides the TTL of both arms on activity', async () => {
    const { service, multiOps } = build();
    const code = await service.issue(GAME_UUID);

    await service.touch(GAME_UUID);

    expect(multiOps.expire).toHaveBeenCalledWith(
      `game_code:${code}`,
      Constants.JOIN_CODE_TTL_SECONDS,
    );
    expect(multiOps.expire).toHaveBeenCalledWith(
      `game_uuid:${GAME_UUID}`,
      Constants.JOIN_CODE_TTL_SECONDS,
    );
  });

  it('does not revive a code that already lapsed', async () => {
    const { service, client, multiOps } = build();
    const code = await service.issue(GAME_UUID);
    client.store.delete(`game_code:${code}`);
    client.store.delete(`game_uuid:${GAME_UUID}`);

    await service.touch(GAME_UUID);

    // Re-minting here would hand a live room a code nobody was told about.
    expect(multiOps.expire).not.toHaveBeenCalled();
    expect(await service.codeFor(GAME_UUID)).toBeNull();
  });

  it('drops both arms when a game is deliberately closed', async () => {
    const { service } = build();
    const code = await service.issue(GAME_UUID);

    await service.revoke(GAME_UUID);

    expect(await service.resolve(code)).toBeNull();
    expect(await service.codeFor(GAME_UUID)).toBeNull();
  });
});

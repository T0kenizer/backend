import * as Constants from '@modules/game-core/game-core.constants';
import { RedisService } from '@modules/redis/services/redis.service';
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/** Redis: the code a player dictates → the session uuid it resolves to. */
function codeKey(code: string): string {
  return `game_code:${code}`;
}

/**
 * Redis: the reverse arm of the same mapping, so a room can display the code
 * that currently reaches it.
 *
 * This is the one addition to the "Redis holds nothing but `code → uuid`" rule,
 * and it is the same mapping read the other way — not a second concern. Without
 * it the host could never show the code to read out, and every page load would
 * have to mint a new one, invalidating the code already dictated. Both arms are
 * written together and share a TTL, so they expire as one.
 */
function uuidKey(gameUuid: string): string {
  return `game_uuid:${gameUuid}`;
}

/**
 * The ephemeral 6-digit code that fronts a session uuid.
 *
 * The code exists only here. It is never persisted: a session that loses its
 * code is still perfectly playable through its uuid, which is the point of
 * keeping the two apart — the code is a convenience for saying a room out loud,
 * the uuid is the identity.
 */
@Injectable()
export class GameCodesService {
  private readonly logger = new Logger(GameCodesService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * Mints a code for a session, retrying on collision.
   *
   * The draw is claimed with `SET NX EX`, so two sessions drawing the same
   * digits in the same millisecond cannot both win it: the loser sees the `NX`
   * fail and draws again. Nothing is checked before writing — a read-then-write
   * would leave exactly the race the `NX` exists to close.
   */
  public async issue(gameUuid: string): Promise<string> {
    const client = this.redisService.client;

    for (
      let attempt = 0;
      attempt < Constants.JOIN_CODE_MAX_ATTEMPTS;
      attempt++
    ) {
      const code = this.drawCode();
      const claimed = await client.set(codeKey(code), gameUuid, {
        condition: 'NX',
        expiration: { type: 'EX', value: Constants.JOIN_CODE_TTL_SECONDS },
      });
      if (claimed === null) continue;

      await client.set(uuidKey(gameUuid), code, {
        expiration: { type: 'EX', value: Constants.JOIN_CODE_TTL_SECONDS },
      });
      return code;
    }

    // 10 collisions across a 10^6 space means the space itself is saturated;
    // a wider code is the fix, not another retry.
    this.logger.error(
      `Could not mint a join code for ${gameUuid} in ${Constants.JOIN_CODE_MAX_ATTEMPTS} attempts`,
    );
    throw new Error('Failed to generate a unique join code');
  }

  /**
   * Resolves a code to its session uuid, or null when it does not resolve.
   *
   * Callers must not distinguish "never existed" from "expired": both are the
   * same null here, and the endpoints above turn both into the same response.
   */
  public async resolve(code: string): Promise<Nullable<string>> {
    return this.redisService.client.get(codeKey(code));
  }

  /**
   * A uniformly drawn 6-digit code, leading zeros included. A method rather
   * than a free function so a test can pin the draw and exercise a collision.
   */
  protected drawCode(): string {
    const max = 10 ** Constants.JOIN_CODE_LENGTH;
    return crypto
      .randomInt(0, max)
      .toString()
      .padStart(Constants.JOIN_CODE_LENGTH, '0');
  }

  /** The code currently reaching a session, or null once it has lapsed. */
  public async codeFor(gameUuid: string): Promise<Nullable<string>> {
    return this.redisService.client.get(uuidKey(gameUuid));
  }

  /**
   * Pushes the TTL of both arms back on activity, so a room in use keeps the
   * code that was dictated for it. A code that has already lapsed is not
   * revived — `EXPIRE` on a missing key is a no-op, and re-minting here would
   * hand a live room a code nobody was told about.
   */
  public async touch(gameUuid: string): Promise<void> {
    const code = await this.codeFor(gameUuid);
    if (!code) return;

    await this.redisService.client
      .multi()
      .expire(codeKey(code), Constants.JOIN_CODE_TTL_SECONDS)
      .expire(uuidKey(gameUuid), Constants.JOIN_CODE_TTL_SECONDS)
      .exec();
  }

  /**
   * Drops the code immediately. Only a deliberate close calls this: an
   * abandoned room needs no cleanup, since the TTL retires its code on its
   * own.
   */
  public async revoke(gameUuid: string): Promise<void> {
    const code = await this.codeFor(gameUuid);
    if (!code) return;

    await this.redisService.client
      .multi()
      .del(codeKey(code))
      .del(uuidKey(gameUuid))
      .exec();
  }
}

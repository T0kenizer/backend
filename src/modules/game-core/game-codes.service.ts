import * as Constants from '@modules/game-core/game-core.constants';
import { RedisService } from '@modules/redis/services/redis.service';
import { Injectable, Logger } from '@nestjs/common';
import { JOIN_CODE_LENGTH } from '@tokenizer/shared/constants/games.constants';
import * as crypto from 'crypto';

function codeKey(code: string): string {
  return `game_code:${code}`;
}

function uuidKey(gameUuid: string): string {
  return `game_uuid:${gameUuid}`;
}

@Injectable()
export class GameCodesService {
  private readonly logger = new Logger(GameCodesService.name);

  constructor(private readonly redisService: RedisService) {}

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

    this.logger.error(
      `Could not mint a join code for ${gameUuid} in ${Constants.JOIN_CODE_MAX_ATTEMPTS} attempts`,
    );
    throw new Error('Failed to generate a unique join code');
  }

  public async resolve(code: string): Promise<Nullable<string>> {
    return this.redisService.client.get(codeKey(code));
  }

  protected drawCode(): string {
    const max = 10 ** JOIN_CODE_LENGTH;
    return crypto.randomInt(0, max).toString().padStart(JOIN_CODE_LENGTH, '0');
  }

  public async codeFor(gameUuid: string): Promise<Nullable<string>> {
    return this.redisService.client.get(uuidKey(gameUuid));
  }

  public async touch(gameUuid: string): Promise<void> {
    const code = await this.codeFor(gameUuid);
    if (!code) return;

    await this.redisService.client
      .multi()
      .expire(codeKey(code), Constants.JOIN_CODE_TTL_SECONDS)
      .expire(uuidKey(gameUuid), Constants.JOIN_CODE_TTL_SECONDS)
      .exec();
  }

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

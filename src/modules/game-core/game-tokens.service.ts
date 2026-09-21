import { ConfigService } from '@modules/config/config.service';
import * as Constants from '@modules/game-core/game-core.constants';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';

const playerTokenPayloadSchema = z.object({
  /** The session the token is valid for, and only that session. */
  gameUuid: z.uuid(),
  /** The seat it speaks for. */
  participantId: z.uuid(),
});

export type PlayerTokenPayload = z.infer<typeof playerTokenPayloadSchema>;

/**
 * Issues and checks the per-player token.
 *
 * Before this, in-game identity was an `externalId` sent in the payload — and a
 * signed-in player's externalId was their user uuid, which the snapshot
 * broadcast to the whole room. Any player at the table could replay someone
 * else's and act as them. The token replaces that with something the client
 * cannot forge, and scopes it to one seat of one session, so a token for one
 * game is worth nothing in another.
 *
 * It is also what makes reconnection work: a player who refreshes presents the
 * token they were issued and lands back in the seat they held.
 */
@Injectable()
export class GameTokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  public issue(payload: PlayerTokenPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.configService.get('SECRET_KEY'),
      expiresIn: Constants.PLAYER_TOKEN_TTL,
    });
  }

  /**
   * Verifies a token and binds it to the session it is being used against. A
   * valid token for another game is rejected here, not deeper in.
   */
  public verify(token: string, gameUuid: string): PlayerTokenPayload {
    const payload = this.decode(token);
    if (payload.gameUuid !== gameUuid) {
      throw new UnauthorizedException('Player token does not match this game');
    }
    return payload;
  }

  /** Verifies the signature without pinning the token to a session. */
  public decode(token: string): PlayerTokenPayload {
    let raw: unknown;
    try {
      raw = this.jwtService.verify(token, {
        secret: this.configService.get('SECRET_KEY'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired player token');
    }

    const parsed = playerTokenPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UnauthorizedException('Malformed player token');
    }
    return parsed.data;
  }
}

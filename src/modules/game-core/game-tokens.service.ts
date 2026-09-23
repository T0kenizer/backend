import { ConfigService } from '@modules/config/config.service';
import * as Constants from '@modules/game-core/game-core.constants';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';

const playerTokenPayloadSchema = z.object({
  gameUuid: z.uuid(),
  participantId: z.uuid(),
});

export type PlayerTokenPayload = z.infer<typeof playerTokenPayloadSchema>;

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

  public verify(token: string, gameUuid: string): PlayerTokenPayload {
    const payload = this.decode(token);
    if (payload.gameUuid !== gameUuid) {
      throw new UnauthorizedException('Player token does not match this game');
    }
    return payload;
  }

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

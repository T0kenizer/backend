import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

/** Header carrying the player token on in-game REST calls. */
export const PLAYER_TOKEN_HEADER = 'x-player-token';

/**
 * Pulls the raw player token off the request.
 *
 * It is deliberately not the session cookie: a player may be anonymous, may
 * hold seats in two games at once, and may have several tabs open. The token is
 * scoped to one seat of one session, which the cookie could never be.
 */
export const RawPlayerToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const token = request.headers[PLAYER_TOKEN_HEADER];
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException(`Missing ${PLAYER_TOKEN_HEADER} header`);
    }
    return token;
  },
);

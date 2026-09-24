import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { PLAYER_TOKEN_HEADER } from '@tokenizer/shared/constants/games.constants';
import type { Request } from 'express';

export const RawPlayerToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    // `get` rather than indexing `headers`: Node lowercases every header
    // name, and the constant is spelled in canonical casing.
    const token = request.get(PLAYER_TOKEN_HEADER);
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException(`Missing ${PLAYER_TOKEN_HEADER} header`);
    }
    return token;
  },
);

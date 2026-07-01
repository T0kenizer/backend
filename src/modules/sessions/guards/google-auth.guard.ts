import { isRelativePath } from '@modules/sessions/sessions.utils';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const redirect = req.query.redirect;

    if (typeof redirect === 'string' && isRelativePath(redirect)) {
      req.session.oauthRedirect = redirect;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err as Error) : resolve()));
      });
    }

    return (await super.canActivate(context)) as boolean;
  }
}

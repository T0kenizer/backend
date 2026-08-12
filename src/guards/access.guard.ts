import { ROLES_KEY, SELF_PARAM_KEY } from '@decorators/access.decorators';
import { User } from '@entities/user.entity';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@tokenizer/shared/types';
import type { Request } from 'express';

/**
 * Grants access when _any_ of the access decorators matches, so a route can be
 * opened to admins and to the user it concerns at the same time.
 *
 * Nest ANDs the guards of a route, so this OR cannot be expressed by combining
 * one guard per rule.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const selfParam = this.reflector.getAllAndOverride<string | undefined>(
      SELF_PARAM_KEY,
      [context.getHandler(), context.getClass()],
    );

    // An undecorated route grants nothing: forgetting a decorator must not open
    // the route to everyone.
    if (!roles?.length && !selfParam)
      throw new ForbiddenException('This route declares no access rule');

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as Nullable<User>;

    if (!user) throw new UnauthorizedException('No active session');

    if (selfParam && user.uuid === req.params[selfParam]) return true;

    if (roles?.includes(user.role)) return true;

    throw new ForbiddenException('You are not allowed to perform this action');
  }
}

import { FEATURE_KEY } from '@decorators/plan.decorators';
import { User } from '@entities/user.entity';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasFeature } from '@tokenizer/shared/constants/plans.constants';
import { Feature, Plan } from '@tokenizer/shared/types';
import type { Request } from 'express';

/**
 * Grants access when the caller's plan holds every feature the route declares.
 * A signed-out caller resolves to `Plan.Anonymous` rather than being
 * special-cased — it is simply a plan that grants nothing.
 *
 * An undecorated route grants nothing: forgetting `@RequiresFeature` must not
 * open the route to everyone (mirrors `AccessGuard`).
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const features = this.reflector.getAllAndOverride<Optional<Feature[]>>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!features?.length)
      throw new ForbiddenException('This route declares no required feature');

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as Nullable<User>;
    const plan = user?.plan ?? Plan.Anonymous;

    if (features.every((feature) => hasFeature(plan, feature))) return true;

    throw new ForbiddenException('Your plan does not grant this action');
  }
}

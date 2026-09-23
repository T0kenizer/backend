import { FEATURE_KEY } from '@decorators/plan.decorators';
import { User } from '@entities/user.entity';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Feature, Plan } from '@tokenizer/shared/types';
import { hasFeature } from '@tokenizer/shared/utils/plans.utils';
import type { Request } from 'express';

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

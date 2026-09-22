import { RequiresFeature } from '@decorators/plan.decorators';
import { User } from '@entities/user.entity';
import { FeatureGuard } from '@guards/feature.guard';
import {
  Controller,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Feature, Plan } from '@tokenizer/shared/types';

@Controller()
class TestController {
  @RequiresFeature(Feature.JoinGame, Feature.CreateGame)
  public everything() {}

  @RequiresFeature(Feature.CreateGame)
  public createOnly() {}

  public undecorated() {}
}

describe('FeatureGuard', () => {
  let guard: FeatureGuard;
  let controller: TestController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestController],
      providers: [FeatureGuard],
    }).compile();

    guard = moduleRef.get(FeatureGuard);
    controller = moduleRef.get(TestController);
  });

  const contextFor = (
    handler: keyof TestController,
    user: Nullable<Partial<User>>,
  ) =>
    ({
      getHandler: () => controller[handler],
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('allows a free user through a route requiring every feature it grants', () => {
    const ctx = contextFor('everything', { plan: Plan.Free });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects an anonymous visitor missing one of the required features', () => {
    // Anonymous grants JoinGame but not CreateGame — misses one of the two.
    const ctx = contextFor('everything', null);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows a premium user through a route it fully covers', () => {
    const ctx = contextFor('createOnly', { plan: Plan.Premium });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a signed-out caller from a feature it does not grant', () => {
    const ctx = contextFor('createOnly', null);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects an undecorated route, so a missing rule never opens it', () => {
    const ctx = contextFor('undecorated', { plan: Plan.Premium });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

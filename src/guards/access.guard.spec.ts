import { AllowSelf, Roles } from '@decorators/access.decorators';
import { User } from '@entities/user.entity';
import { AccessGuard } from '@guards/access.guard';
import {
  Controller,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ADMIN_ROLES } from '@tokenizer/shared/constants/users.constants';
import { UserRole } from '@tokenizer/shared/types';

const SELF_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

@Controller()
class TestController {
  @AllowSelf('uuid')
  @Roles(...ADMIN_ROLES)
  public selfOrAdmin() {}

  @Roles(...ADMIN_ROLES)
  public adminOnly() {}

  @AllowSelf('uuid')
  public selfOnly() {}

  public undecorated() {}
}

describe('AccessGuard', () => {
  let guard: AccessGuard;
  let controller: TestController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestController],
      providers: [AccessGuard],
    }).compile();

    guard = moduleRef.get(AccessGuard);
    controller = moduleRef.get(TestController);
  });

  const contextFor = (
    handler: keyof TestController,
    user: Nullable<Partial<User>>,
    params: Record<string, string> = { uuid: SELF_UUID },
  ) =>
    ({
      getHandler: () => controller[handler],
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
    }) as unknown as ExecutionContext;

  describe('self or admin', () => {
    it('allows the user designated by the route param', () => {
      const ctx = contextFor('selfOrAdmin', {
        uuid: SELF_UUID,
        role: UserRole.User,
      });

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows an admin acting on somebody else', () => {
      const ctx = contextFor('selfOrAdmin', {
        uuid: OTHER_UUID,
        role: UserRole.Admin,
      });

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows an owner acting on somebody else', () => {
      const ctx = contextFor('selfOrAdmin', {
        uuid: OTHER_UUID,
        role: UserRole.Owner,
      });

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects a plain user acting on somebody else', () => {
      const ctx = contextFor('selfOrAdmin', {
        uuid: OTHER_UUID,
        role: UserRole.User,
      });

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  it('rejects a matching uuid when only roles are declared', () => {
    const ctx = contextFor('adminOnly', {
      uuid: SELF_UUID,
      role: UserRole.User,
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects an admin acting on somebody else when only self is declared', () => {
    const ctx = contextFor('selfOnly', {
      uuid: OTHER_UUID,
      role: UserRole.Admin,
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects an undecorated route, so a missing rule never opens it', () => {
    const ctx = contextFor('undecorated', {
      uuid: SELF_UUID,
      role: UserRole.Owner,
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects an anonymous request', () => {
    const ctx = contextFor('selfOrAdmin', null);

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when the route param is absent', () => {
    const ctx = contextFor(
      'selfOrAdmin',
      { uuid: SELF_UUID, role: UserRole.User },
      {},
    );

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

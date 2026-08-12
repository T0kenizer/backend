import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@tokenizer/shared/types';

export const ROLES_KEY = 'access:roles';

export const SELF_PARAM_KEY = 'access:self-param';

/** Grants access to the listed roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Grants access to the user designated by a route param, so a user can act on
 * their own account.
 *
 * @param param The route param holding the target user uuid.
 */
export const AllowSelf = (param = 'uuid') => SetMetadata(SELF_PARAM_KEY, param);

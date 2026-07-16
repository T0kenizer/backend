import {
  changePasswordSchema,
  deleteAccountSchema,
  profileResponseSchema,
  updateProfileSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateProfileData extends createZodDto(updateProfileSchema) {}
export class ChangePasswordData extends createZodDto(changePasswordSchema) {}
export class DeleteAccountData extends createZodDto(deleteAccountSchema) {}
export class ProfileResponse extends createZodDto(profileResponseSchema) {}

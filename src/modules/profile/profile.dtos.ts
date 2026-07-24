import {
  changePasswordSchema,
  confirmDeletionSchema,
  profileResponseSchema,
  updateProfileSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateProfileData extends createZodDto(updateProfileSchema) {}
export class ChangePasswordData extends createZodDto(changePasswordSchema) {}
export class ConfirmDeletionData extends createZodDto(confirmDeletionSchema) {}
export class ProfileResponse extends createZodDto(profileResponseSchema) {}

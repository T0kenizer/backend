import {
  createUserDataSchema,
  createUserResponseSchema,
  partialUpdateUserDataSchema,
  partialUpdateUserResponseSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** Create User DTOs */

export class CreateUserData extends createZodDto(createUserDataSchema) {}
export class CreateUserResponse extends createZodDto(
  createUserResponseSchema,
) {}

/** Partial Update User DTOs */

export class PartialUpdateUserData extends createZodDto(
  partialUpdateUserDataSchema,
) {}
export class PartialUpdateUserResponse extends createZodDto(
  partialUpdateUserResponseSchema,
) {}

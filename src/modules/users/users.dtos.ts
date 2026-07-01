import {
  createUserDataSchema,
  createUserResponseSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** Create User DTOs */

export class CreateUserData extends createZodDto(createUserDataSchema) {}
export class CreateUserResponse extends createZodDto(
  createUserResponseSchema,
) {}

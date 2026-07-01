import {
  createSessionDataSchema,
  createSessionResponseSchema,
  retrieveSessionResponseSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** Create Session DTOs */

export class CreateSessionData extends createZodDto(createSessionDataSchema) {}
export class CreateSessionResponse extends createZodDto(
  createSessionResponseSchema,
) {}

/** Retrieve Session DTOs */

export class RetrieveSessionResponse extends createZodDto(
  retrieveSessionResponseSchema,
) {}

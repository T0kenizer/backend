import { validateDeletionTokenResponseSchema } from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** Validate Deletion Token DTOs */

export class ValidateDeletionTokenResponse extends createZodDto(
  validateDeletionTokenResponseSchema,
) {}

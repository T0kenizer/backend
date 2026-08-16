import {
  requestConfirmationDataSchema,
  validateConfirmationTokenResponseSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** Request Confirmation DTOs */

export class RequestConfirmationData extends createZodDto(
  requestConfirmationDataSchema,
) {}

/** Validate Confirmation Token DTOs */

export class ValidateConfirmationTokenResponse extends createZodDto(
  validateConfirmationTokenResponseSchema,
) {}

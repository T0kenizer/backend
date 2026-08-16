import {
  createFileQuerySchema,
  createFileResponseSchema,
  retrieveFileResponseSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** Create File DTOs */

export class CreateFileQuery extends createZodDto(createFileQuerySchema) {}
export class CreateFileResponse extends createZodDto(
  createFileResponseSchema,
) {}

/** Retrieve File DTOs */

export class RetrieveFileResponse extends createZodDto(
  retrieveFileResponseSchema,
) {}

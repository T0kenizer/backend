import { listPlansResponseSchema } from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** List Plans DTOs */

export class ListPlansResponse extends createZodDto(listPlansResponseSchema) {}

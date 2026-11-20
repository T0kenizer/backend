import { listOffersResponseSchema } from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** List Offers DTOs */

export class ListOffersResponse extends createZodDto(
  listOffersResponseSchema,
) {}

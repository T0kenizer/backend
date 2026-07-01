import {
  applyResetDataSchema,
  requestResetDataSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** Request Reset DTOs */

export class RequestResetData extends createZodDto(requestResetDataSchema) {}

/** Apply Reset DTOs */

export class ApplyResetData extends createZodDto(applyResetDataSchema) {}

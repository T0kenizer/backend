import {
  applyResetSchema,
  requestResetSchema,
} from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class RequestResetData extends createZodDto(requestResetSchema) {}
export class ApplyResetData extends createZodDto(applyResetSchema) {}

import { requestResetSchema } from '@tokenizer/shared/schemas';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class RequestResetData extends createZodDto(requestResetSchema) {}

export class ApplyResetData extends createZodDto(
  z.object({ password: z.string().nonempty().max(72) }),
) {}

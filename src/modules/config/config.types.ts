import type { configSchema } from '@modules/config/config.schema';
import type z from 'zod';

export type Config = z.infer<typeof configSchema>;

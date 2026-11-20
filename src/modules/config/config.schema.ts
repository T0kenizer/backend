import { z } from 'zod';

const unlessEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const STRIPE_SETTINGS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CALLBACK_URL',
] as const;

export const configSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),

    POSTGRES_HOST: z.string().nonempty(),
    POSTGRES_PORT: z.coerce.number().default(5432),
    POSTGRES_USER: z.string().nonempty(),
    POSTGRES_PASSWORD: z.string().nonempty(),
    POSTGRES_DB: z.string().nonempty(),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM_DOMAIN: z.string().optional(),

    REDIS_HOST: z.string().nonempty(),
    REDIS_PORT: z.coerce.number().default(6379),

    REDIS_QUEUE_HOST: z.string().nonempty(),
    REDIS_QUEUE_PORT: z.coerce.number().default(6379),

    REDIS_CACHE_HOST: z.string().nonempty(),
    REDIS_CACHE_PORT: z.coerce.number().default(6379),

    SECRET_KEY: z.string().nonempty(),

    FIREBASE_PROJECT_ID: z.string().nonempty(),
    FIREBASE_CLIENT_EMAIL: z.string().nonempty(),
    FIREBASE_PRIVATE_KEY: z
      .string()
      .nonempty()
      // Compose/env files escape newlines in the PEM key, restore them.
      .transform((key) => key.replace(/\\n/g, '\n')),
    FIREBASE_STORAGE_BUCKET: z.string().nonempty(),

    GOOGLE_CLIENT_ID: z.string().nonempty(),
    GOOGLE_CLIENT_SECRET: z.string().nonempty(),
    GOOGLE_CALLBACK_URL: z.url(),

    STRIPE_ENABLED: unlessEmpty(
      z.stringbool({ truthy: ['true'], falsy: ['false'] }).default(false),
    ),
    STRIPE_SECRET_KEY: unlessEmpty(z.string().optional()),
    STRIPE_WEBHOOK_SECRET: unlessEmpty(z.string().optional()),
    STRIPE_CALLBACK_URL: unlessEmpty(z.url().optional()),

    FRONTEND_URL: z.url(),
  })
  .superRefine((config, ctx) => {
    if (!config.STRIPE_ENABLED) return;

    for (const key of STRIPE_SETTINGS)
      if (!config[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Required when STRIPE_ENABLED is true',
        });
  });

import { configSchema } from '@modules/config/config.schema';

const ENV = {
  POSTGRES_HOST: 'postgres',
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: 'postgres',
  POSTGRES_DB: 'tokenizer',
  REDIS_HOST: 'redis',
  REDIS_QUEUE_HOST: 'redis-queue',
  REDIS_CACHE_HOST: 'redis-cache',
  SECRET_KEY: 'secret',
  FIREBASE_PROJECT_ID: 'project',
  FIREBASE_CLIENT_EMAIL: 'firebase@tokenizer.fr',
  FIREBASE_PRIVATE_KEY: 'key',
  FIREBASE_STORAGE_BUCKET: 'bucket',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/sessions/google/callback',
  FRONTEND_URL: 'http://localhost:8080',
};

const STRIPE = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  STRIPE_CALLBACK_URL: 'http://localhost:3000/subscriptions/stripe/callback',
};

const issuesOf = (env: Record<string, string>) =>
  configSchema.safeParse(env).error?.issues.map(({ path }) => path.join('.'));

describe('configSchema', () => {
  describe('Stripe', () => {
    it('is disabled by default, and then needs none of its settings', () => {
      const result = configSchema.safeParse(ENV);

      expect(result.success).toBe(true);
      expect(result.data?.STRIPE_ENABLED).toBe(false);
    });

    // How compose passes the variables of an env file that does not set them.
    it('reads empty settings as missing', () => {
      const result = configSchema.safeParse({
        ...ENV,
        STRIPE_ENABLED: '',
        STRIPE_SECRET_KEY: '',
        STRIPE_WEBHOOK_SECRET: '',
        STRIPE_CALLBACK_URL: '',
      });

      expect(result.success).toBe(true);
      expect(result.data?.STRIPE_ENABLED).toBe(false);
    });

    it('requires every setting once enabled', () => {
      expect(issuesOf({ ...ENV, STRIPE_ENABLED: 'true' })).toEqual([
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_CALLBACK_URL',
      ]);
    });

    it('accepts an enabled Stripe with all its settings', () => {
      const result = configSchema.safeParse({
        ...ENV,
        ...STRIPE,
        STRIPE_ENABLED: 'true',
      });

      expect(result.success).toBe(true);
      expect(result.data?.STRIPE_ENABLED).toBe(true);
    });

    // Anything else would silently read as disabled on one side and enabled
    // on the other, the frontend only knowing `true`.
    it('rejects a value other than true or false', () => {
      expect(issuesOf({ ...ENV, ...STRIPE, STRIPE_ENABLED: '1' })).toEqual([
        'STRIPE_ENABLED',
      ]);
    });
  });
});

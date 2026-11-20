import { configSchema } from '@modules/config/config.schema';

export const isStripeEnabled = (env: NodeJS.ProcessEnv): boolean =>
  configSchema.shape.STRIPE_ENABLED.parse(env.STRIPE_ENABLED);

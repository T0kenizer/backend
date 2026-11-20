import { isStripeEnabled } from '@modules/stripe/stripe.utils';

describe('isStripeEnabled', () => {
  it('reads an unset variable as disabled', () => {
    expect(isStripeEnabled({})).toBe(false);
  });

  // Compose passes an unset variable as an empty string, which the string
  // condition of `ConditionalModule` would have read as enabled.
  it('reads an empty variable as disabled', () => {
    expect(isStripeEnabled({ STRIPE_ENABLED: '' })).toBe(false);
  });

  it('reads false as disabled', () => {
    expect(isStripeEnabled({ STRIPE_ENABLED: 'false' })).toBe(false);
  });

  it('reads true as enabled, whatever its case', () => {
    expect(isStripeEnabled({ STRIPE_ENABLED: 'true' })).toBe(true);
    expect(isStripeEnabled({ STRIPE_ENABLED: 'TRUE' })).toBe(true);
  });
});

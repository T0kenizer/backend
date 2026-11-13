import { StripeSyncCommand } from '@commands/stripe-sync.command';
import type { ConfigService } from '@modules/config/config.service';
import {
  CATALOG,
  DEFAULT_PRODUCT_IMAGE,
  PRODUCTS,
} from '@modules/offers/offers.catalog';
import { planOf } from '@modules/offers/offers.utils';
import type { StripeService } from '@modules/stripe/stripe.service';
import { Offer, Plan } from '@tokenizer/shared/types';
import Stripe from 'stripe';

const PREMIUM = CATALOG[Offer.PremiumMonthly];
const [PREMIUM_PRICE] = PREMIUM.prices;
const PREMIUM_METADATA = { plan: Plan.Premium };

const missing = () =>
  Object.assign(
    Object.create(
      Stripe.errors.StripeInvalidRequestError.prototype,
    ) as Stripe.errors.StripeInvalidRequestError,
    { code: 'resource_missing' },
  );

// A Stripe price matching what the catalog declares for `lookupKey`.
const stripePrice = (lookupKey: string, overrides: object = {}) => {
  const offer = Object.values(Offer).find((offer) =>
    CATALOG[offer].prices.some((price) => price.lookupKey === lookupKey),
  )!;
  const { product, prices } = CATALOG[offer];
  const price = prices.find((entry) => entry.lookupKey === lookupKey)!;

  return {
    id: `price_${lookupKey}`,
    active: true,
    product: product.id,
    currency: price.currency,
    unit_amount: price.unitAmount,
    recurring: price.interval ? { interval: price.interval } : null,
    metadata: { offer, plan: planOf(offer) },
    ...overrides,
  };
};

// The Stripe product of `id` as the sync would write it.
const stripeProduct = (id: string, overrides: object = {}) => {
  const [plan, product] = Object.entries(PRODUCTS).find(
    ([, product]) => product.id === id,
  )!;

  return {
    name: product.name,
    description: product.description,
    marketing_features: product.marketingFeatures.map((name) => ({ name })),
    images: [`https://tokenizer.fr${DEFAULT_PRODUCT_IMAGE}`],
    metadata: { plan },
    ...overrides,
  };
};

const syncedPrices = ({
  lookup_keys: [lookupKey],
}: {
  lookup_keys: string[];
}) => Promise.resolve({ data: [stripePrice(lookupKey)] });

function build(isLive = false, frontendUrl = 'https://tokenizer.fr') {
  const client = {
    products: {
      retrieve: jest.fn().mockRejectedValue(missing()),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    prices: {
      list: jest.fn().mockResolvedValue({ data: [] }),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const command = new StripeSyncCommand(
    { client, isLive } as unknown as StripeService,
    { get: () => frontendUrl } as unknown as ConfigService,
  );

  return { command, client };
}

describe('StripeSyncCommand', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('creates the products and prices of an empty account', async () => {
    const { command, client } = build();

    await command.run([]);

    expect(client.products.create).toHaveBeenCalledWith({
      id: PREMIUM.product.id,
      name: PREMIUM.product.name,
      description: PREMIUM.product.description,
      marketing_features: PREMIUM.product.marketingFeatures.map((name) => ({
        name,
      })),
      images: [`https://tokenizer.fr${DEFAULT_PRODUCT_IMAGE}`],
      metadata: PREMIUM_METADATA,
    });
    expect(client.prices.create).toHaveBeenCalledWith({
      product: PREMIUM.product.id,
      currency: PREMIUM_PRICE.currency,
      unit_amount: PREMIUM_PRICE.unitAmount,
      recurring: { interval: PREMIUM_PRICE.interval },
      lookup_key: PREMIUM_PRICE.lookupKey,
      transfer_lookup_key: true,
      metadata: { offer: Offer.PremiumMonthly, plan: Plan.Premium },
    });
    expect(client.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup_key: 'founder_lifetime',
        recurring: undefined,
      }),
    );
  });

  it('writes nothing when Stripe already matches the catalog', async () => {
    const { command, client } = build();
    client.products.retrieve.mockImplementation((id: string) =>
      Promise.resolve(stripeProduct(id)),
    );
    client.prices.list.mockImplementation(syncedPrices);

    await command.run([]);

    expect(client.products.create).not.toHaveBeenCalled();
    expect(client.products.update).not.toHaveBeenCalled();
    expect(client.prices.create).not.toHaveBeenCalled();
    expect(client.prices.update).not.toHaveBeenCalled();
  });

  it('clears the metadata keys the catalog does not declare', async () => {
    const { command, client } = build();
    client.products.retrieve.mockImplementation((id: string) =>
      Promise.resolve(
        stripeProduct(id, {
          metadata: {
            ...PREMIUM_METADATA,
            create_game_max_seats: '12',
          },
        }),
      ),
    );
    client.prices.list.mockImplementation(syncedPrices);

    await command.run([]);

    expect(client.products.update).toHaveBeenCalledWith(
      PREMIUM.product.id,
      expect.objectContaining({
        metadata: { ...PREMIUM_METADATA, create_game_max_seats: '' },
      }),
    );
  });

  it('updates a product whose marketing copy changed', async () => {
    const { command, client } = build();
    client.products.retrieve.mockImplementation((id: string) =>
      Promise.resolve(stripeProduct(id, { marketing_features: [] })),
    );
    client.prices.list.mockImplementation(syncedPrices);

    await command.run([]);

    expect(client.products.update).toHaveBeenCalledWith(
      PREMIUM.product.id,
      expect.objectContaining({
        marketing_features: PREMIUM.product.marketingFeatures.map((name) => ({
          name,
        })),
        metadata: undefined,
      }),
    );
  });

  it('stamps the plan on a price that only carries its offer', async () => {
    const { command, client } = build();
    client.prices.list.mockImplementation(
      ({ lookup_keys: [lookupKey] }: { lookup_keys: string[] }) =>
        Promise.resolve({
          data: [
            stripePrice(lookupKey, {
              metadata: { offer: Offer.PremiumMonthly },
            }),
          ],
        }),
    );

    await command.run([]);

    expect(client.prices.update).toHaveBeenCalledWith(
      `price_${PREMIUM_PRICE.lookupKey}`,
      { metadata: { offer: Offer.PremiumMonthly, plan: Plan.Premium } },
    );
    expect(client.prices.create).not.toHaveBeenCalled();
  });

  it('replaces a price whose amount changed and archives the old one', async () => {
    const { command, client } = build();
    client.prices.list.mockImplementation(
      ({ lookup_keys: [lookupKey] }: { lookup_keys: string[] }) =>
        Promise.resolve({
          data: [
            stripePrice(
              lookupKey,
              lookupKey === PREMIUM_PRICE.lookupKey ? { unit_amount: 1 } : {},
            ),
          ],
        }),
    );

    await command.run([]);

    expect(client.prices.create).toHaveBeenCalledTimes(1);
    expect(client.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup_key: PREMIUM_PRICE.lookupKey,
        unit_amount: PREMIUM_PRICE.unitAmount,
        transfer_lookup_key: true,
      }),
    );
    expect(client.prices.update).toHaveBeenCalledWith(
      `price_${PREMIUM_PRICE.lookupKey}`,
      { active: false },
    );
  });

  it('leaves an archived price archived', async () => {
    const { command, client } = build();
    client.prices.list.mockImplementation(
      ({ lookup_keys: [lookupKey] }: { lookup_keys: string[] }) =>
        Promise.resolve({ data: [stripePrice(lookupKey, { active: false })] }),
    );

    await command.run([]);

    expect(client.prices.create).not.toHaveBeenCalled();
    expect(client.prices.update).not.toHaveBeenCalled();
  });

  it('leaves the images alone when the frontend is local', async () => {
    const { command, client } = build(false, 'http://localhost:8080');
    client.products.retrieve.mockImplementation((id: string) =>
      Promise.resolve(
        stripeProduct(id, {
          images: ['https://files.stripe.com/uploaded-by-hand'],
        }),
      ),
    );

    await command.run([]);

    expect(client.products.update).not.toHaveBeenCalledWith(
      PREMIUM.product.id,
      expect.anything(),
    );
  });

  it('writes nothing on a dry run', async () => {
    const { command, client } = build();

    await command.run([], { dryRun: true });

    expect(client.products.create).not.toHaveBeenCalled();
    expect(client.prices.create).not.toHaveBeenCalled();
  });

  it('refuses a live key unless told otherwise', async () => {
    const { command, client } = build(true);

    await expect(command.run([])).rejects.toThrow('--live');
    expect(client.products.retrieve).not.toHaveBeenCalled();

    await command.run([], { live: true });
    expect(client.products.create).toHaveBeenCalled();
  });
});

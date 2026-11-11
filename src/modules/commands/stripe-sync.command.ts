import { ConfigService } from '@modules/config/config.service';
import {
  CATALOG,
  DEFAULT_PRODUCT_IMAGE,
  OFFER_METADATA_KEY,
  PLAN_METADATA_KEY,
  PRODUCTS,
} from '@modules/offers/offers.catalog';
import type {
  CatalogPlan,
  CatalogPrice,
  CatalogProduct,
} from '@modules/offers/offers.types';
import { planOf } from '@modules/offers/offers.utils';
import { StripeService } from '@modules/stripe/stripe.service';
import { Offer } from '@tokenizer/shared/types';
import { Command, CommandRunner, Option } from 'nest-commander';
import Stripe from 'stripe';

interface StripeSyncOptions {
  dryRun?: boolean;
  live?: boolean;
}

@Command({
  name: 'stripe-sync',
  description: 'Create or update the Stripe products and prices of the catalog',
})
export class StripeSyncCommand extends CommandRunner {
  constructor(
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Print what would change without writing to Stripe.',
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({
    flags: '--live',
    description: 'Allow running against a live mode key.',
  })
  parseLive(): boolean {
    return true;
  }

  async run(_: string[], options: StripeSyncOptions = {}): Promise<void> {
    const dryRun = !!options.dryRun;

    if (this.stripeService.isLive && !options.live)
      throw new Error(
        'STRIPE_SECRET_KEY is a live mode key, pass --live to sync it.',
      );

    for (const plan of Object.keys(PRODUCTS) as CatalogPlan[])
      await this.syncProduct(plan, PRODUCTS[plan], dryRun);
    for (const offer of Object.values(Offer))
      for (const price of CATALOG[offer].prices)
        await this.syncPrice(offer, price, dryRun);

    console.log(
      dryRun ? 'Dry run, nothing was written.' : 'Stripe is in sync.',
    );
  }

  private async syncProduct(
    plan: CatalogPlan,
    product: CatalogProduct,
    dryRun: boolean,
  ): Promise<void> {
    const { client } = this.stripeService;
    const metadata = { [PLAN_METADATA_KEY]: plan };
    const images = this.imagesOf(product.image);
    const marketingFeatures = product.marketingFeatures.map((name) => ({
      name,
    }));
    const existing = await this.findProduct(product.id);

    if (!existing) {
      console.log(`+ product ${product.id}`);
      if (!dryRun)
        await client.products.create({
          id: product.id,
          name: product.name,
          description: product.description,
          marketing_features: marketingFeatures,
          images,
          metadata,
        });
      return;
    }

    const metadataChanges = this.metadataChanges(existing.metadata, metadata);
    const isUpToDate =
      existing.name === product.name &&
      (existing.description ?? '') === product.description &&
      this.sameList(
        existing.marketing_features.map(({ name }) => name ?? ''),
        product.marketingFeatures,
      ) &&
      (!images || this.sameList(existing.images, images)) &&
      !metadataChanges;

    if (isUpToDate) {
      console.log(`= product ${product.id}`);
      return;
    }

    console.log(`~ product ${product.id}`);
    if (!dryRun)
      await client.products.update(product.id, {
        name: product.name,
        description: product.description,
        // An empty string is how Stripe clears the list.
        marketing_features: marketingFeatures.length ? marketingFeatures : '',
        images,
        metadata: metadataChanges ?? undefined,
      });
  }

  private async syncPrice(
    offer: Offer,
    price: CatalogPrice,
    dryRun: boolean,
  ): Promise<void> {
    const { client } = this.stripeService;
    const { product } = CATALOG[offer];
    const metadata = {
      [OFFER_METADATA_KEY]: offer,
      [PLAN_METADATA_KEY]: planOf(offer),
    };
    // Archived prices included: archiving one is how an offer is closed, and
    // that must survive a sync.
    const { data } = await client.prices.list({
      lookup_keys: [price.lookupKey],
    });
    const existing = data.at(0);

    if (existing && this.matches(existing, product.id, price)) {
      const metadataChanges = this.metadataChanges(existing.metadata, metadata);
      const archived = existing.active ? '' : ' (archived, left as is)';

      console.log(
        `${metadataChanges ? '~' : '='} price ${price.lookupKey}${archived}`,
      );
      if (metadataChanges && !dryRun)
        await client.prices.update(existing.id, { metadata: metadataChanges });
      return;
    }

    // A Stripe price cannot be edited: the new one takes over the lookup key,
    // and the subscriptions already on the old one stay there.
    console.log(`${existing ? '~' : '+'} price ${price.lookupKey}`);
    if (dryRun) return;

    await client.prices.create({
      product: product.id,
      currency: price.currency,
      unit_amount: price.unitAmount,
      recurring: price.interval ? { interval: price.interval } : undefined,
      lookup_key: price.lookupKey,
      transfer_lookup_key: true,
      metadata,
    });
    if (existing?.active)
      await client.prices.update(existing.id, { active: false });
  }

  // The update turning `existing` into exactly `wanted`, or null when they
  // already match. Stripe merges metadata, so a key the catalog dropped is
  // cleared with an empty string.
  private metadataChanges(
    existing: Stripe.Metadata,
    wanted: Record<string, string>,
  ): Nullable<Record<string, string>> {
    const stale = Object.keys(existing).filter((key) => !(key in wanted));
    const changed = Object.keys(wanted).filter(
      (key) => existing[key] !== wanted[key],
    );
    if (!stale.length && !changed.length) return null;

    return {
      ...Object.fromEntries(stale.map((key) => [key, ''])),
      ...wanted,
    };
  }

  private sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((entry, i) => entry === b[i]);
  }

  private matches(
    existing: Stripe.Price,
    productId: string,
    price: CatalogPrice,
  ): boolean {
    const existingProductId =
      typeof existing.product === 'string'
        ? existing.product
        : existing.product.id;

    return (
      existingProductId === productId &&
      existing.currency === price.currency &&
      existing.unit_amount === price.unitAmount &&
      (existing.recurring?.interval ?? undefined) === price.interval
    );
  }

  // Stripe fetches the image itself: one served from a local frontend would
  // only ever show up broken, so the images of the product are left alone.
  private imagesOf(image = DEFAULT_PRODUCT_IMAGE): Optional<string[]> {
    const url = new URL(image, this.configService.get('FRONTEND_URL'));
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

    return isLocal ? undefined : [url.toString()];
  }

  private async findProduct(id: string): Promise<Nullable<Stripe.Product>> {
    try {
      return await this.stripeService.client.products.retrieve(id);
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === 'resource_missing'
      )
        return null;
      throw error;
    }
  }
}

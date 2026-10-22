import type * as Types from '@modules/subscriptions/subscriptions.types';
import {
  BillingInterval,
  Offer,
  Plan,
  type UserPlan,
} from '@tokenizer/shared/types';

export const PRODUCTS: Record<
  Exclude<UserPlan, Plan.Free>,
  Types.CatalogProduct
> = {
  [Plan.Premium]: {
    id: 'tokenizer_premium',
    name: 'Tokenizer Premium',
  },
  [Plan.Founder]: {
    id: 'tokenizer_founder',
    name: 'Tokenizer Founder',
  },
};

export const CATALOG: Record<Offer, Types.CatalogOffer> = {
  [Offer.PremiumMonthly]: {
    product: PRODUCTS[Plan.Premium],
    prices: [
      {
        lookupKey: 'premium_monthly',
        unitAmount: 199,
        currency: 'eur',
        interval: BillingInterval.Month,
        displayed: true,
      },
    ],
  },
  [Offer.PremiumYearly]: {
    product: PRODUCTS[Plan.Premium],
    prices: [
      {
        lookupKey: 'premium_yearly',
        unitAmount: 1999,
        currency: 'eur',
        interval: BillingInterval.Year,
        displayed: true,
      },
    ],
  },
  // Sold for life: a one-time fee on top of a 0-priced subscription, so it
  // stays an `active` subscription like any other.
  [Offer.FounderLifetime]: {
    product: PRODUCTS[Plan.Founder],
    prices: [
      {
        lookupKey: 'founder_subscription',
        unitAmount: 0,
        currency: 'eur',
        interval: BillingInterval.Year,
      },
      {
        lookupKey: 'founder_lifetime',
        unitAmount: 1499,
        currency: 'eur',
        displayed: true,
      },
    ],
  },
};

export const PLAN_METADATA_KEY = 'plan';

export const OFFER_METADATA_KEY = 'offer';

export const DEFAULT_PRODUCT_IMAGE = '/logo/tokenizer-mark-512.png';

import type * as Types from '@modules/offers/offers.types';
import { PlanAccess } from '@modules/plans/plans.access';
import {
  BillingInterval,
  Offer,
  Plan,
  type UserPlan,
} from '@tokenizer/shared/types';

function maxSeatsFeature(plan: Plan): string {
  return `Up to ${PlanAccess.of(plan).maxSeats} seats per table`;
}

function maxActiveGamesFeature(plan: Plan): string {
  const { maxActiveGames: max } = PlanAccess.of(plan);
  if (max === Infinity) return 'As many games as you want';

  return `Up to ${max} active ${max === 1 ? 'game' : 'games'} at once`;
}

export const PRODUCTS: Record<
  Exclude<UserPlan, Plan.Free>,
  Types.CatalogProduct
> = {
  [Plan.Premium]: {
    id: 'tokenizer_premium',
    name: 'Tokenizer Premium',
    description: 'More seats. More possibilities.',
    marketingFeatures: [
      'Create and join tables',
      maxSeatsFeature(Plan.Premium),
      maxActiveGamesFeature(Plan.Premium),
      'Poker mode',
      'Sandbox mode',
    ],
  },
  [Plan.Founder]: {
    id: 'tokenizer_founder',
    name: 'Tokenizer Founder',
    description:
      'Back Tokenizer from the very start and keep permanent access to the included features.',
    marketingFeatures: [
      'Create and join tables',
      maxSeatsFeature(Plan.Founder),
      maxActiveGamesFeature(Plan.Founder),
      'Poker mode',
      'Sandbox mode',
      'One-time payment, no subscription',
      'Founder status',
    ],
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

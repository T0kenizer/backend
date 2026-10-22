import type { PRODUCTS } from '@modules/subscriptions/subscriptions.catalog';
import { BillingInterval } from '@tokenizer/shared/types';

export interface CatalogPrice {
  lookupKey: string;
  unitAmount: number;
  currency: string;
  // Absent on a one-time price.
  interval?: BillingInterval;
  // The price the pricing page shows for the offer, exactly one per offer.
  displayed?: true;
}

export interface CatalogOffer {
  product: CatalogProduct;
  prices: readonly CatalogPrice[];
}

export interface CatalogProduct {
  id: string;
  name: string;
  image?: string;
}

export type CatalogPlan = keyof typeof PRODUCTS;

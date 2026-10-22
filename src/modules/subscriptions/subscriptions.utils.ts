import {
  CATALOG,
  PRODUCTS,
} from '@modules/subscriptions/subscriptions.catalog';
import type { CatalogPlan } from '@modules/subscriptions/subscriptions.types';
import { Offer } from '@tokenizer/shared/types';

export function planOf(offer: Offer): CatalogPlan {
  const { product } = CATALOG[offer];
  const plan = (Object.keys(PRODUCTS) as CatalogPlan[]).find(
    (plan) => PRODUCTS[plan].id === product.id,
  );
  if (!plan) throw new Error(`Offer ${offer} sells no product of a plan`);

  return plan;
}

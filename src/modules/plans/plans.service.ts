import { PLAN_METADATA } from '@modules/plans/plans.constants';
import { CATALOG } from '@modules/subscriptions/subscriptions.catalog';
import { planOf } from '@modules/subscriptions/subscriptions.utils';
import { Injectable } from '@nestjs/common';
import {
  Offer,
  Plan,
  type ListPlansResponse,
  type PlanOffer,
  type PlanPrice,
} from '@tokenizer/shared/types';

@Injectable()
export class PlansService {
  public list(): ListPlansResponse {
    const plans = Object.values(Plan).map((plan) => [
      plan,
      { features: PLAN_METADATA[plan], offers: this.offersOf(plan) },
    ]);

    return Object.fromEntries(plans) as ListPlansResponse;
  }

  // The offers of the catalog granting the plan, in the order it declares them.
  private offersOf(plan: Plan): PlanOffer[] {
    return Object.values(Offer)
      .filter((offer) => planOf(offer) === plan)
      .map((offer) => ({ offer, price: this.priceOf(offer) }));
  }

  // The price the catalog marks as displayed, a lifetime offer also carrying a
  // 0-priced subscription that is not worth showing.
  private priceOf(offer: Offer): PlanPrice {
    const price = CATALOG[offer].prices.find(({ displayed }) => displayed);
    if (!price) throw new Error(`Offer ${offer} displays no price`);

    return {
      amount: price.unitAmount,
      currency: price.currency,
      interval: price.interval ?? null,
    };
  }
}

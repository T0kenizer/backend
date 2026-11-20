import { CATALOG } from '@modules/offers/offers.catalog';
import { planOf } from '@modules/offers/offers.utils';
import { Injectable } from '@nestjs/common';
import {
  Offer,
  type ListOffersResponse,
  type OfferPrice,
} from '@tokenizer/shared/types';

@Injectable()
export class OffersService {
  // Every offer of the catalog, in the order it declares them.
  public list(): ListOffersResponse {
    return Object.values(Offer).map((offer) => ({
      offer,
      plan: planOf(offer),
      price: this.priceOf(offer),
    }));
  }

  // The price the catalog marks as displayed, a lifetime offer also carrying a
  // 0-priced subscription that is not worth showing.
  private priceOf(offer: Offer): OfferPrice {
    const price = CATALOG[offer].prices.find(({ displayed }) => displayed);
    if (!price) throw new Error(`Offer ${offer} displays no price`);

    return {
      amount: price.unitAmount,
      currency: price.currency,
      interval: price.interval ?? null,
    };
  }
}

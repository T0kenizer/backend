import { OffersService } from '@modules/offers/offers.service';
import { listOffersResponseSchema } from '@tokenizer/shared/schemas';
import { Offer, Plan } from '@tokenizer/shared/types';

describe('OffersService', () => {
  const offers = new OffersService().list();

  it('describes every offer in the shape the frontend expects', () => {
    expect(listOffersResponseSchema.safeParse(offers).success).toBe(true);
    expect(offers.map(({ offer }) => offer)).toEqual(Object.values(Offer));
  });

  it('names the plan each offer grants', () => {
    expect(offers).toMatchObject([
      { offer: Offer.PremiumMonthly, plan: Plan.Premium },
      { offer: Offer.PremiumYearly, plan: Plan.Premium },
      { offer: Offer.FounderLifetime, plan: Plan.Founder },
    ]);
  });

  it('prices a recurring offer by its interval', () => {
    const monthly = offers.find(({ offer }) => offer === Offer.PremiumMonthly);

    expect(monthly?.price).toMatchObject({ interval: 'month' });
  });

  it('prices a lifetime offer by its one-time fee', () => {
    const lifetime = offers.find(
      ({ offer }) => offer === Offer.FounderLifetime,
    );

    expect(lifetime?.price.interval).toBeNull();
    expect(lifetime?.price.amount).toBeGreaterThan(0);
  });
});

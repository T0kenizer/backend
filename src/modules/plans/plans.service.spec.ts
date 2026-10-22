import { PLAN_METADATA } from '@modules/plans/plans.constants';
import { PlansService } from '@modules/plans/plans.service';
import { listPlansResponseSchema } from '@tokenizer/shared/schemas';
import { Offer, Plan } from '@tokenizer/shared/types';

describe('PlansService', () => {
  const plans = new PlansService().list();

  it('describes every plan in the shape the frontend expects', () => {
    expect(listPlansResponseSchema.safeParse(plans).success).toBe(true);
    expect(plans[Plan.Free].features).toEqual(PLAN_METADATA[Plan.Free]);
  });

  it('sells only the paid plans', () => {
    expect(plans[Plan.Anonymous].offers).toEqual([]);
    expect(plans[Plan.Free].offers).toEqual([]);
    expect(plans[Plan.Premium].offers).toMatchObject([
      { offer: Offer.PremiumMonthly, price: { interval: 'month' } },
    ]);
  });

  it('prices a lifetime offer by its one-time fee', () => {
    const [{ price }] = plans[Plan.Founder].offers;

    expect(price.interval).toBeNull();
    expect(price.amount).toBeGreaterThan(0);
  });
});

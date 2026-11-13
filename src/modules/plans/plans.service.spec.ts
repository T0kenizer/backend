import { PLAN_METADATA } from '@modules/plans/plans.constants';
import { PlansService } from '@modules/plans/plans.service';
import { listPlansResponseSchema } from '@tokenizer/shared/schemas';
import { Plan } from '@tokenizer/shared/types';

describe('PlansService', () => {
  const plans = new PlansService().list();

  it('describes every plan in the shape the frontend expects', () => {
    expect(listPlansResponseSchema.safeParse(plans).success).toBe(true);
  });

  it.each(Object.values(Plan))('serves what %s grants', (plan) => {
    expect(plans[plan].features).toEqual(PLAN_METADATA[plan]);
  });
});

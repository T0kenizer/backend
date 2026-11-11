import { PlanAccess } from '@modules/plans/plans.access';
import { Injectable } from '@nestjs/common';
import { Plan, type ListPlansResponse } from '@tokenizer/shared/types';

@Injectable()
export class PlansService {
  public list(): ListPlansResponse {
    const plans = Object.values(Plan).map((plan) => [
      plan,
      { features: PlanAccess.of(plan).features },
    ]);

    return Object.fromEntries(plans) as ListPlansResponse;
  }
}

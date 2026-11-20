import { PLAN_METADATA } from '@modules/plans/plans.constants';
import {
  Feature,
  type FeatureMetadataMap,
  GameMode,
  Plan,
  type PlanMetadata,
  type UserPlan,
} from '@tokenizer/shared/types';

export class PlanAccess {
  private static readonly instances = new Map<Plan, PlanAccess>();

  private constructor(public readonly plan: Plan) {}

  public static of(plan: Plan): PlanAccess {
    let access = PlanAccess.instances.get(plan);
    if (!access) {
      access = new PlanAccess(plan);
      PlanAccess.instances.set(plan, access);
    }

    return access;
  }

  public static for(user: Nullish<{ plan: UserPlan }>): PlanAccess {
    return PlanAccess.of(user?.plan ?? Plan.Anonymous);
  }

  public get features(): PlanMetadata {
    return PLAN_METADATA[this.plan];
  }

  public metadata<F extends Feature>(feature: F): FeatureMetadataMap[F] {
    return this.features[feature];
  }

  public grants(...features: Feature[]): boolean {
    return features.every((feature) => this.metadata(feature).access);
  }

  public get modes(): readonly GameMode[] {
    return this.metadata(Feature.CreateGame).modes;
  }

  public allowsMode(mode: GameMode): boolean {
    return this.modes.includes(mode);
  }

  public get maxSeats(): number {
    return this.metadata(Feature.CreateGame).maxSeats;
  }

  public allowsSeats(count: number): boolean {
    return count <= this.maxSeats;
  }

  public get maxActiveGames(): number {
    return this.metadata(Feature.CreateGame).maxActiveGames;
  }
}

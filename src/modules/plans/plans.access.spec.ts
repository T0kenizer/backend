import { PlanAccess } from '@modules/plans/plans.access';
import { PLAN_METADATA } from '@modules/plans/plans.constants';
import { Feature, GameMode, Plan } from '@tokenizer/shared/types';

describe('PlanAccess', () => {
  it('reads what a plan grants from its metadata', () => {
    expect(PlanAccess.of(Plan.Premium).features).toBe(
      PLAN_METADATA[Plan.Premium],
    );
  });

  it('hands out one access per plan', () => {
    expect(PlanAccess.of(Plan.Free)).toBe(PlanAccess.of(Plan.Free));
  });

  it('treats a visitor without a user as anonymous', () => {
    expect(PlanAccess.for(null).plan).toBe(Plan.Anonymous);
    expect(PlanAccess.for({ plan: Plan.Founder }).plan).toBe(Plan.Founder);
  });

  it('grants a set of features only when it grants each of them', () => {
    const anonymous = PlanAccess.of(Plan.Anonymous);

    expect(anonymous.grants(Feature.JoinGame)).toBe(true);
    expect(anonymous.grants(Feature.JoinGame, Feature.CreateGame)).toBe(false);
    expect(
      PlanAccess.of(Plan.Free).grants(Feature.JoinGame, Feature.CreateGame),
    ).toBe(true);
  });

  it('allows only the modes the plan includes', () => {
    expect(PlanAccess.of(Plan.Free).allowsMode(GameMode.Free)).toBe(false);
    expect(PlanAccess.of(Plan.Premium).allowsMode(GameMode.Free)).toBe(true);
  });

  it('allows a table up to its most seats', () => {
    const free = PlanAccess.of(Plan.Free);

    expect(free.allowsSeats(free.maxSeats)).toBe(true);
    expect(free.allowsSeats(free.maxSeats + 1)).toBe(false);
  });

  it('reads an unlimited number of active games as Infinity', () => {
    expect(PlanAccess.of(Plan.Free).maxActiveGames).toBe(1);
    expect(PlanAccess.of(Plan.Premium).maxActiveGames).toBe(Infinity);
  });
});

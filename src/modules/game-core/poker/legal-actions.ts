import {
  BettingStructure,
  PokerAction,
  Street,
  type LegalAction,
  type PokerRules,
} from '@tokenizer/shared/types';

export const FIXED_LIMIT_MAX_RAISES = 4;

export interface BettingContext {
  rules: PokerRules;
  street: Street;
  currentBet: number;
  minRaiseTo: number;
  raiseCount: number;
  committed: number;
  stack: number;
  potTotal: number;
  canRaise: boolean;
}

export const fixedLimitIncrement = (
  rules: PokerRules,
  street: Street,
): number =>
  street === Street.Preflop || street === Street.Flop
    ? rules.blinds.big
    : rules.blinds.big * 2;

export function legalActionsFor(ctx: BettingContext): LegalAction[] {
  const { currentBet, committed, stack } = ctx;

  const toCall = Math.max(0, currentBet - committed);
  const allInTo = committed + stack;
  const canCommit = stack > 0;

  const actions: LegalAction[] = [{ action: PokerAction.Fold, label: 'Fold' }];

  if (toCall === 0) {
    actions.push({ action: PokerAction.Check, label: 'Check' });
  } else if (canCommit) {
    const callTo = Math.min(currentBet, allInTo);
    actions.push({
      action: PokerAction.Call,
      label: 'Call',
      min: callTo,
      max: callTo,
    });
  }

  const opening = currentBet === 0;
  const raiseBounds = !ctx.canRaise
    ? null
    : opening
      ? openingBetBounds(ctx)
      : raiseBounds_(ctx);

  if (raiseBounds) {
    actions.push({
      action: opening ? PokerAction.Bet : PokerAction.Raise,
      label: opening ? 'Bet' : 'Raise',
      min: raiseBounds.min,
      max: raiseBounds.max,
    });
  }

  if (
    ctx.rules.bettingStructure === BettingStructure.NoLimit &&
    ctx.canRaise &&
    canCommit &&
    allInTo > currentBet
  ) {
    actions.push({
      action: PokerAction.AllIn,
      label: 'All in',
      min: allInTo,
      max: allInTo,
    });
  }

  return actions;
}

function openingBetBounds(
  ctx: BettingContext,
): Nullable<{ min: number; max: number }> {
  const { rules, street, committed, stack, potTotal } = ctx;
  if (stack <= 0) return null;

  const allInTo = committed + stack;

  if (rules.bettingStructure === BettingStructure.FixedLimit) {
    if (ctx.raiseCount >= FIXED_LIMIT_MAX_RAISES) return null;
    const to = Math.min(fixedLimitIncrement(rules, street), allInTo);
    return { min: to, max: to };
  }

  const min = Math.min(rules.blinds.big, allInTo);
  const cap =
    rules.bettingStructure === BettingStructure.PotLimit
      ? Math.max(min, Math.min(potTotal, allInTo))
      : allInTo;

  return { min, max: Math.max(min, cap) };
}

function raiseBounds_(
  ctx: BettingContext,
): Nullable<{ min: number; max: number }> {
  const { rules, street, currentBet, minRaiseTo, committed, stack, potTotal } =
    ctx;
  if (stack <= 0) return null;

  const allInTo = committed + stack;
  if (allInTo <= currentBet) return null;

  if (rules.bettingStructure === BettingStructure.FixedLimit) {
    if (ctx.raiseCount >= FIXED_LIMIT_MAX_RAISES) return null;
    const to = Math.min(
      currentBet + fixedLimitIncrement(rules, street),
      allInTo,
    );
    return { min: to, max: to };
  }

  const min = Math.min(minRaiseTo, allInTo);

  if (rules.bettingStructure === BettingStructure.PotLimit) {
    const toCall = currentBet - committed;
    const cap = Math.min(currentBet + potTotal + toCall, allInTo);
    return { min, max: Math.max(min, cap) };
  }

  return { min, max: allInTo };
}

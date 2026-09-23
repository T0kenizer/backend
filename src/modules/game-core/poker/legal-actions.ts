import {
  BettingStructure,
  PokerAction,
  Street,
  type LegalAction,
  type PokerRules,
} from '@tokenizer/shared/types';

/**
 * Traditional fixed-limit cap: one bet and three raises per street. Without it
 * a fixed-limit street between two deep stacks never ends.
 */
export const FIXED_LIMIT_MAX_RAISES = 4;

/** The state a legal-action question is answered against. */
export interface BettingContext {
  rules: PokerRules;
  street: Street;
  /** The total each seat must have committed on this street to stay in. */
  currentBet: number;
  /** The smallest legal raise, as a total for this street. */
  minRaiseTo: number;
  /** Bets and raises already made on this street (fixed-limit cap). */
  raiseCount: number;
  /** What the seat being asked has committed on this street. */
  committed: number;
  /** What it has left behind that commitment. */
  stack: number;
  /** Everything wagered in the hand so far, this street included. */
  potTotal: number;
  /**
   * Whether this seat may still put the bet up. False only after an all-in
   * raised the bet by less than a full raise: the seats it caught out owe the
   * difference but have lost the right to re-raise.
   */
  canRaise: boolean;
}

/** The fixed-limit betting unit: one big blind early, two from the turn. */
export const fixedLimitIncrement = (
  rules: PokerRules,
  street: Street,
): number =>
  street === Street.Preflop || street === Street.Flop
    ? rules.blinds.big
    : rules.blinds.big * 2;

/**
 * What the active seat may do, as totals for the current street.
 *
 * This is the whole of "which actions are available", and it lives here rather
 * than in a config because it is not a preference: a check exists when nothing
 * is owed, a raise exists when there are chips left to raise with, and a host
 * who could switch either off would be running a different game.
 */
export function legalActionsFor(ctx: BettingContext): LegalAction[] {
  const { currentBet, committed, stack } = ctx;

  const toCall = Math.max(0, currentBet - committed);
  /** The most this seat could possibly have in on this street. */
  const allInTo = committed + stack;
  const canCommit = stack > 0;

  const actions: LegalAction[] = [{ action: PokerAction.Fold, label: 'Fold' }];

  if (toCall === 0) {
    actions.push({ action: PokerAction.Check, label: 'Check' });
  } else if (canCommit) {
    // Short of the bet, a call is an all-in for what is left — still a call,
    // and still the only amount it can be.
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

  // All in is a no-limit move. Under pot limit and fixed limit there is a cap
  // on what may go in, and "the rest of my stack" is not a legal size unless
  // it happens to land under it — in which case it is already the maximum
  // raise above, under its proper name.
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

/** Bounds of an opening bet, or null when one cannot be made. */
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

  // A stack shorter than one big blind can still be pushed in: an all-in is
  // never denied for being too small.
  const min = Math.min(rules.blinds.big, allInTo);
  const cap =
    rules.bettingStructure === BettingStructure.PotLimit
      ? Math.max(min, Math.min(potTotal, allInTo))
      : allInTo;

  return { min, max: Math.max(min, cap) };
}

/** Bounds of a raise, or null when one cannot be made. */
function raiseBounds_(
  ctx: BettingContext,
): Nullable<{ min: number; max: number }> {
  const { rules, street, currentBet, minRaiseTo, committed, stack, potTotal } =
    ctx;
  if (stack <= 0) return null;

  const allInTo = committed + stack;
  // Nothing to raise with: the seat cannot even get past the current bet, so
  // its only move with chips is the (all-in) call already offered.
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
    // The pot-sized raise: match the bet first, then bet what is then in the
    // middle — so the cap counts the caller's own call as already in.
    const toCall = currentBet - committed;
    const cap = Math.min(currentBet + potTotal + toCall, allInTo);
    return { min, max: Math.max(min, cap) };
  }

  return { min, max: allInTo };
}

/**
 * Pot construction.
 *
 * Poker does not have "a pot mode" — it has one pot until somebody cannot match
 * the betting, and a side pot the moment they cannot. Nothing here is
 * configurable, because nothing about it is a choice: the layers follow from
 * who put in how much.
 */

export interface PotLayer {
  id: string;
  amount: number;
  /** The seats that may take this layer: those who paid all the way into it. */
  eligibleParticipants: string[];
  isSidePot: boolean;
}

/**
 * Splits everything wagered in the hand into the pots it actually forms.
 *
 * The layers are cut at each distinct amount a _contender_ committed. Chips
 * from seats that folded stay in the layers they reached — a fold does not take
 * money back — and chips nobody could match end up in a layer only their owner
 * is eligible for, which is how an uncalled bet finds its way home without
 * being a special case.
 *
 * Rebuilt from the running contributions rather than mutated as chips move: a
 * side pot is a consequence of the whole hand so far, and a structure grown
 * incrementally has to be un-grown every time somebody re-raises.
 *
 * @param contributions What each seat has put in across the whole hand.
 * @param contenders The seats still in the hand (not folded).
 * @param idFor Stable identifier for the layer at this index — pot ids must
 *   survive from one snapshot to the next, or every client redraws the table.
 */
export function buildPots(
  contributions: ReadonlyMap<string, number>,
  contenders: ReadonlySet<string>,
  idFor: (index: number) => string,
): PotLayer[] {
  const total = [...contributions.values()].reduce((sum, a) => sum + a, 0);
  if (total === 0) return [];

  const levels = [
    ...new Set(
      [...contributions]
        .filter(([id, amount]) => amount > 0 && contenders.has(id))
        .map(([, amount]) => amount),
    ),
  ].sort((a, b) => a - b);

  // Nobody left standing has any chips in (every contender checked their way
  // here, or the only money in came from folded seats): a single pot, open to
  // whoever is still contesting it.
  if (levels.length === 0) {
    return [
      {
        id: idFor(0),
        amount: total,
        eligibleParticipants: [...contenders],
        isSidePot: false,
      },
    ];
  }

  const layers: PotLayer[] = [];
  let floor = 0;

  for (const level of levels) {
    let amount = 0;
    for (const contribution of contributions.values()) {
      amount += Math.min(contribution, level) - Math.min(contribution, floor);
    }

    if (amount > 0) {
      layers.push({
        id: idFor(layers.length),
        amount,
        eligibleParticipants: [...contenders].filter(
          (id) => (contributions.get(id) ?? 0) >= level,
        ),
        isSidePot: layers.length > 0,
      });
    }
    floor = level;
  }

  return layers;
}

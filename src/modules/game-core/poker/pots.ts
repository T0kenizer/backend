export interface PotLayer {
  id: string;
  amount: number;
  eligibleParticipants: string[];
  isSidePot: boolean;
}

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

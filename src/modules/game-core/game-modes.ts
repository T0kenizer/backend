import {
  BettingStructure,
  ChipModel,
  GameMode,
  type GameConfig,
  type GameModeDescriptor,
} from '@tokenizer/shared/types';

/**
 * The games Tokenizer knows how to run.
 *
 * A mode is the first thing a host chooses and the last word on everything
 * after it: which parameters they are asked for, which moves a player is
 * offered, when a hand ends. There is one today. A second one is an entry here
 * and a member on `gameConfigSchema` — and because the config is a union
 * discriminated on `mode`, the compiler finds every place that has to learn
 * about it rather than letting it default to poker's answer.
 */
export const GAME_MODES: readonly GameModeDescriptor[] = [
  {
    mode: GameMode.Poker,
    name: 'Poker',
    description:
      'No-limit hold’em betting: blinds, four streets, and the pot to ' +
      'whoever is left — or to whoever the table calls at showdown.',
    defaults: {
      mode: GameMode.Poker,
      seating: {
        seats: [
          { displayName: 'Seat 1' },
          { displayName: 'Seat 2' },
          { displayName: 'Seat 3' },
          { displayName: 'Seat 4' },
        ],
        defaultInitialBalance: 1000,
        allowMidGameClaims: true,
        // A poker night is exactly the case for it: four declared seats, and
        // a fifth person turning up once they are all taken.
        allowExtraSeats: true,
      },
      rules: {
        blinds: { small: 5, big: 10 },
        ante: 0,
        bettingStructure: BettingStructure.NoLimit,
        chipModel: ChipModel.AbstractBalance,
      },
    },
  },
];

/**
 * The descriptor for a mode, or `undefined` for one we do not run. The defaults
 * are deep-cloned on every call: `GAME_MODES` is a shared module-level
 * constant, and callers hand its config to the runtime, which treats it as its
 * own — mutating it in place would corrupt it for every table opened
 * afterwards.
 */
export function getMode(mode: string): Optional<GameModeDescriptor> {
  const descriptor = GAME_MODES.find(
    (entry) => (entry.mode as string) === mode,
  );
  if (!descriptor) return undefined;

  return { ...descriptor, defaults: structuredClone(descriptor.defaults) };
}

/** The table a mode opens with when the host does not set one up themselves. */
export function defaultConfigFor(mode: GameMode): GameConfig {
  const descriptor = getMode(mode);
  if (!descriptor) {
    throw new Error(`No default config for unknown game mode "${mode}"`);
  }
  return descriptor.defaults;
}

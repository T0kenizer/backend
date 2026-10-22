import {
  AmountForm,
  BettingStructure,
  ChipModel,
  Direction,
  EndResolution,
  GameMode,
  PayoutMode,
  PotMode,
  TurnRegime,
  type GameConfig,
  type GameModeDescriptor,
} from '@tokenizer/shared/types';
import { parseEnum } from '@utils/enums.utils';

// Listed in the order a host is offered them, poker first.
export const GAME_MODES: Record<GameMode, GameModeDescriptor> = {
  [GameMode.Poker]: {
    mode: GameMode.Poker,
    name: 'Poker',
    description:
      'No-limit hold’em betting: blinds, four streets, and the pot to ' +
      'whoever is left — or to whoever the table calls at showdown.',
    experimental: false,
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
  [GameMode.Free]: {
    mode: GameMode.Free,
    name: 'Sandbox',
    description:
      'Your own game: you name the moves, the opening bets and the way the ' +
      'turn travels. Tokenizer only keeps the chips straight.',
    experimental: true,
    defaults: {
      mode: GameMode.Free,
      seating: {
        seats: [
          { displayName: 'Seat 1' },
          { displayName: 'Seat 2' },
          { displayName: 'Seat 3' },
          { displayName: 'Seat 4' },
        ],
        defaultInitialBalance: 1000,
        allowMidGameClaims: true,
        allowExtraSeats: true,
      },
      economy: {
        potMode: PotMode.Single,
        chipModel: ChipModel.AbstractBalance,
        payoutMode: PayoutMode.WinnerTakesAll,
        forcedBets: [
          { label: 'small_blind', amount: 5, seatOffset: 0 },
          { label: 'big_blind', amount: 10, seatOffset: 1 },
        ],
      },
      actionCatalog: [
        {
          id: 'check',
          label: 'Check',
          amountForm: AmountForm.None,
          grantsInterruption: false,
        },
        {
          id: 'call',
          label: 'Call',
          amountForm: AmountForm.Constrained,
          grantsInterruption: false,
        },
        {
          id: 'raise',
          label: 'Raise',
          amountForm: AmountForm.Raise,
          grantsInterruption: false,
        },
        {
          id: 'fold',
          label: 'Fold',
          amountForm: AmountForm.None,
          grantsInterruption: false,
          foldsParticipant: true,
        },
      ],
      turnPolicy: {
        regime: TurnRegime.Sequential,
        direction: Direction.Clockwise,
        interruptionWindow: null,
      },
      endPolicy: {
        resolution: EndResolution.Automatic,
        conditions: [{ type: 'LAST_PLAYER_STANDING', params: null }],
      },
    },
  },
};

export function getMode(mode: string): Optional<GameModeDescriptor> {
  const known = parseEnum(Object.values(GameMode), mode);
  if (!known) return undefined;

  const descriptor = GAME_MODES[known];
  return { ...descriptor, defaults: structuredClone(descriptor.defaults) };
}

export function defaultConfigFor(mode: GameMode): GameConfig {
  const descriptor = getMode(mode);
  if (!descriptor) {
    throw new Error(`No default config for unknown game mode "${mode}"`);
  }
  return descriptor.defaults;
}

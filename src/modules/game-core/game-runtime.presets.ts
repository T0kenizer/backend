import {
  AmountForm,
  ChipModel,
  Direction,
  EndResolution,
  PayoutMode,
  PotMode,
  TurnRegime,
  type GameConfig,
} from '@tokenizer/shared/types';

/**
 * A poker-flavoured default used when a session is created without an explicit
 * config. It exercises the full runtime: pre-declared seats, forced blinds,
 * sequential turns, a folding action, and an automatic "last player standing"
 * end condition.
 */
export function defaultGameConfig(): GameConfig {
  return {
    seating: {
      seats: [
        { displayName: 'Seat 1' },
        { displayName: 'Seat 2' },
        { displayName: 'Seat 3' },
        { displayName: 'Seat 4' },
      ],
      defaultInitialBalance: 1000,
      allowMidGameClaims: true,
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
  };
}

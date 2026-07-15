import { AmountForm } from '@modules/game-core/config/action-def';
import {
  ChipModel,
  PayoutMode,
  PotMode,
} from '@modules/game-core/config/economy-policy';
import { EndResolution } from '@modules/game-core/config/end-policy';
import type { GameConfig } from '@modules/game-core/config/game-config';
import { Direction, TurnRegime } from '@modules/game-core/config/turn-policy';

/**
 * A poker-flavoured default used when a session is created without an explicit
 * config. It exercises the full runtime: forced blinds, sequential turns, a
 * folding action, and an automatic "last player standing" end condition.
 */
export function defaultGameConfig(): GameConfig {
  return {
    economy: {
      potMode: PotMode.SINGLE,
      chipModel: ChipModel.ABSTRACT_BALANCE,
      payoutMode: PayoutMode.WINNER_TAKES_ALL,
      forcedBets: [
        { label: 'small_blind', amount: 5, seatOffset: 0 },
        { label: 'big_blind', amount: 10, seatOffset: 1 },
      ],
    },
    actionCatalog: [
      {
        id: 'check',
        label: 'Check',
        amountForm: AmountForm.NONE,
        grantsInterruption: false,
      },
      {
        id: 'call',
        label: 'Call',
        amountForm: AmountForm.CONSTRAINED,
        grantsInterruption: false,
      },
      {
        id: 'raise',
        label: 'Raise',
        amountForm: AmountForm.RAISE,
        grantsInterruption: false,
      },
      {
        id: 'fold',
        label: 'Fold',
        amountForm: AmountForm.NONE,
        grantsInterruption: false,
        foldsParticipant: true,
      },
    ],
    turnPolicy: {
      regime: TurnRegime.SEQUENTIAL,
      direction: Direction.CLOCKWISE,
      interruptionWindow: null,
    },
    endPolicy: {
      resolution: EndResolution.AUTOMATIC,
      conditions: [{ type: 'LAST_PLAYER_STANDING', params: null }],
    },
  };
}

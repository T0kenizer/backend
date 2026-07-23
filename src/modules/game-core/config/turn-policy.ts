import type { Duration } from '@modules/game-core/game-core.types';

export enum TurnRegime {
  SEQUENTIAL = 'SEQUENTIAL',
  SEQUENTIAL_INTERRUPTIBLE = 'SEQUENTIAL_INTERRUPTIBLE',
  SIMULTANEOUS = 'SIMULTANEOUS',
}

export enum Direction {
  CLOCKWISE = 'CLOCKWISE',
  COUNTER_CLOCKWISE = 'COUNTER_CLOCKWISE',
}

export interface TurnPolicy {
  regime: TurnRegime;
  direction: Direction;
  /** Null when the regime does not allow interruptions */
  interruptionWindow: Duration;
}

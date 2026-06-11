import type { GameConfig } from '../config/game-config';
import type {
  ControllerIdentifier,
  GameSessionId,
  ParticipantId,
} from '../types';
import { Participant, ParticipantStatus } from './participant';
import { Round, RoundStatus } from './round';

export enum GameSessionStatus {
  LOBBY = 'LOBBY',
  RUNNING = 'RUNNING',
  FINISHED = 'FINISHED',
}

export class GameSession {
  readonly id: GameSessionId;
  status: GameSessionStatus;
  /** Immutable once the session is created */
  readonly config: GameConfig;
  readonly participants: Map<ParticipantId, Participant>;
  currentRound?: Round;

  constructor(id: GameSessionId, config: GameConfig) {
    this.id = id;
    this.config = config;
    this.status = GameSessionStatus.LOBBY;
    this.participants = new Map();
  }

  addParticipant(params: {
    displayName: string;
    initialBalance: number;
    controller: ControllerIdentifier;
  }): Participant {
    if (this.status !== GameSessionStatus.LOBBY) {
      throw new Error('Participants can only be added while in LOBBY');
    }
    const seatIndex = this.participants.size;
    const participant = new Participant({
      displayName: params.displayName,
      balance: params.initialBalance,
      seatIndex,
      controller: params.controller,
    });
    this.participants.set(participant.id, participant);
    return participant;
  }

  startRound(): Round {
    if (this.status === GameSessionStatus.FINISHED) {
      throw new Error('Session is already finished');
    }
    if (
      this.currentRound !== undefined &&
      (this.currentRound.status === RoundStatus.INIT ||
        this.currentRound.status === RoundStatus.IN_PROGRESS)
    ) {
      throw new Error('Resolve the current round before starting a new one');
    }

    const active = [...this.participants.values()]
      .filter((p) => p.status !== ParticipantStatus.ELIMINATED)
      .sort((a, b) => a.seatIndex - b.seatIndex);

    if (active.length < 2) {
      throw new Error('At least 2 non-eliminated participants are required');
    }

    if (this.status === GameSessionStatus.LOBBY) {
      this.status = GameSessionStatus.RUNNING;
    }

    // Reset per-round state — FOLDED reverts to ACTIVE; ELIMINATED stays out
    for (const p of active) {
      if (p.status === ParticipantStatus.FOLDED) {
        p.status = ParticipantStatus.ACTIVE;
      }
    }

    const round = new Round(this.config, this.participants, active);
    this.currentRound = round;
    return round;
  }

  closeSession(): void {
    this.currentRound?.resolve();
    this.status = GameSessionStatus.FINISHED;
  }
}

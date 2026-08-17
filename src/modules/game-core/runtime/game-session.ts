import type {
  ControllerIdentifier,
  GameSessionId,
  ParticipantId,
} from '@modules/game-core/game-core.types';
import { Participant } from '@modules/game-core/runtime/participant';
import { Round } from '@modules/game-core/runtime/round';
import {
  GameSessionStatus,
  ParticipantStatus,
  RoundStatus,
  type GameConfig,
} from '@tokenizer/shared/types';

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
    this.status = GameSessionStatus.Lobby;
    this.participants = new Map();
  }

  addParticipant(params: {
    displayName: string;
    initialBalance: number;
    controller: ControllerIdentifier;
  }): Participant {
    if (this.status !== GameSessionStatus.Lobby) {
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
    if (this.status === GameSessionStatus.Finished) {
      throw new Error('Session is already finished');
    }
    if (
      this.currentRound !== undefined &&
      (this.currentRound.status === RoundStatus.Init ||
        this.currentRound.status === RoundStatus.InProgress)
    ) {
      throw new Error('Resolve the current round before starting a new one');
    }

    const active = [...this.participants.values()]
      .filter((p) => p.status !== ParticipantStatus.Eliminated)
      .sort((a, b) => a.seatIndex - b.seatIndex);

    if (active.length < 2) {
      throw new Error('At least 2 non-eliminated participants are required');
    }

    if (this.status === GameSessionStatus.Lobby) {
      this.status = GameSessionStatus.Running;
    }

    // Reset per-round state — FOLDED reverts to ACTIVE; ELIMINATED stays out
    for (const p of active) {
      if (p.status === ParticipantStatus.Folded) {
        p.status = ParticipantStatus.Active;
      }
    }

    const round = new Round(this.config, this.participants, active);
    this.currentRound = round;
    return round;
  }

  closeSession(): void {
    this.currentRound?.resolve();
    this.status = GameSessionStatus.Finished;
  }
}

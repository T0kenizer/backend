import type { ActionDef } from '@modules/game-core/config/action-def';
import type {
  GameSessionId,
  ParticipantId,
  PotId,
  RoundId,
} from '@modules/game-core/game-core.types';
import type { GameSession } from '@modules/game-core/runtime/game-session';
import type { Participant } from '@modules/game-core/runtime/participant';
import type { Pot } from '@modules/game-core/runtime/pot';
import type { Round } from '@modules/game-core/runtime/round';

/**
 * Plain, serialisable read-models of the runtime aggregate. These are the only
 * shapes that leave the module (REST responses, WebSocket payloads); the rich
 * domain objects never cross the boundary.
 */

export interface ParticipantSnapshot {
  id: ParticipantId;
  displayName: string;
  balance: number;
  seatIndex: number;
  status: string;
  controller: string;
}

export interface PotSnapshot {
  id: PotId;
  amount: number;
  eligibleParticipants: ParticipantId[];
}

export interface ActionSnapshot {
  id: string;
  participantId: ParticipantId;
  definitionId: string;
  amount?: number;
  timestamp: string;
}

export interface RoundSnapshot {
  id: RoundId;
  status: string;
  pots: PotSnapshot[];
  turn: {
    activeParticipant: ParticipantId;
    interruptionOpen: boolean;
    pendingClaims: number;
    legalActions: ActionDef[];
  };
  actionLog: ActionSnapshot[];
}

export interface GameSnapshot {
  id: GameSessionId;
  status: string;
  participants: ParticipantSnapshot[];
  currentRound: RoundSnapshot | null;
}

function serializeParticipant(p: Participant): ParticipantSnapshot {
  return {
    id: p.id,
    displayName: p.displayName,
    balance: p.balance,
    seatIndex: p.seatIndex,
    status: p.status,
    controller: p.controller,
  };
}

function serializePot(pot: Pot): PotSnapshot {
  return {
    id: pot.id,
    amount: pot.amount,
    eligibleParticipants: [...pot.eligibleParticipants],
  };
}

function serializeRound(round: Round): RoundSnapshot {
  return {
    id: round.id,
    status: round.status,
    pots: round.pots.map(serializePot),
    turn: {
      activeParticipant: round.turnState.activeParticipant,
      interruptionOpen: round.turnState.interruptionOpen,
      pendingClaims: round.turnState.pendingClaims.length,
      legalActions: round.turnState.computeLegalActions(),
    },
    actionLog: round.actionLog.map((a) => ({
      id: a.id,
      participantId: a.participantId,
      definitionId: a.definitionId,
      amount: a.amount,
      timestamp: a.timestamp.toISOString(),
    })),
  };
}

export function serializeSession(
  id: GameSessionId,
  session: GameSession,
): GameSnapshot {
  return {
    id,
    status: session.status,
    participants: [...session.participants.values()]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map(serializeParticipant),
    currentRound: session.currentRound
      ? serializeRound(session.currentRound)
      : null,
  };
}

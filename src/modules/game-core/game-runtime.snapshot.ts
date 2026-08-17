import type { GameSessionId } from '@modules/game-core/game-core.types';
import type { GameSession } from '@modules/game-core/runtime/game-session';
import type { Participant } from '@modules/game-core/runtime/participant';
import type { Pot } from '@modules/game-core/runtime/pot';
import type { Round } from '@modules/game-core/runtime/round';
import type {
  GameSnapshot,
  ParticipantSnapshot,
  PotSnapshot,
  RoundSnapshot,
} from '@tokenizer/shared/types';

/**
 * Serializers producing the plain read-models of the runtime aggregate (shapes
 * defined in `@tokenizer/shared`). These are the only shapes that leave the
 * module (REST responses, WebSocket payloads); the rich domain objects never
 * cross the boundary.
 */

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

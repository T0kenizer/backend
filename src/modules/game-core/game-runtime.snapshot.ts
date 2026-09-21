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

/**
 * Raw runtime participant fields, before `displayName`/`photoUrl` are resolved
 * (account/config fallback needs DB access the runtime doesn't have —
 * `GameRoomsService` finishes the job before this crosses the wire).
 */
export interface RawParticipantSnapshot extends Omit<
  ParticipantSnapshot,
  'displayName' | 'photoUrl'
> {
  displayNameOverride: Nullable<string>;
  hasPhotoOverride: boolean;
}

function serializeParticipant(p: Participant): RawParticipantSnapshot {
  return {
    id: p.id,
    role: p.role,
    displayNameOverride: p.displayNameOverride,
    hasPhotoOverride: p.hasPhotoOverride,
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

/**
 * The runtime aggregate has no notion of the join code (a DB/room concern) or
 * of the final `displayName`/`photoUrl` (account/config fallback resolved
 * outside it); callers finish both when the snapshot crosses into
 * REST/WebSocket responses.
 */
export type RuntimeSnapshot = Omit<
  GameSnapshot,
  'joinCode' | 'participants'
> & {
  participants: RawParticipantSnapshot[];
};

export function serializeSession(
  id: string,
  session: GameSession,
): RuntimeSnapshot {
  return {
    id,
    status: session.status,
    participants: session.seats.map(serializeParticipant),
    currentRound: session.currentRound
      ? serializeRound(session.currentRound)
      : null,
  };
}

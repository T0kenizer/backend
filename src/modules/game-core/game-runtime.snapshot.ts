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
 * Raw runtime participant fields, before `displayName`/`photoUrl`/`connected`
 * are resolved — the first two need DB access the runtime doesn't have, the
 * third is a presence read. `GameRoomsService` finishes all three before this
 * crosses the wire.
 *
 * `controller` is carried here for that resolution step and dropped on the way
 * out: a snapshot reaches every socket in the room, so the identity holding a
 * seat must not survive into it.
 */
export interface RawParticipantSnapshot extends Omit<
  ParticipantSnapshot,
  'displayName' | 'photoUrl' | 'connected' | 'claimed'
> {
  displayNameOverride: Nullable<string>;
  controller: Nullable<string>;
}

function serializeParticipant(p: Participant): RawParticipantSnapshot {
  return {
    id: p.id,
    role: p.role,
    displayNameOverride: p.displayNameOverride,
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
 * The runtime aggregate knows nothing of the join code (an ephemeral Redis
 * concern), the session name (a DB column), or the resolved participant fields;
 * callers finish all of them when the snapshot crosses into REST/WebSocket
 * responses.
 */
export type RuntimeSnapshot = Omit<
  GameSnapshot,
  'joinCode' | 'name' | 'participants'
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

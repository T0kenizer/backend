import type { Hand } from '@modules/game-core/poker/hand';
import type { HandEvent } from '@modules/game-core/poker/hand-event';
import type { PotLayer } from '@modules/game-core/poker/pots';
import type { GameSession } from '@modules/game-core/runtime/game-session';
import type { Participant } from '@modules/game-core/runtime/participant';
import type {
  GameSnapshot,
  HandEventSnapshot,
  HandSnapshot,
  ParticipantSnapshot,
  PotSnapshot,
  TableStakes,
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

function serializePot(pot: PotLayer): PotSnapshot {
  return {
    id: pot.id,
    amount: pot.amount,
    eligibleParticipants: [...pot.eligibleParticipants],
    isSidePot: pot.isSidePot,
  };
}

function serializeEvent(event: HandEvent): HandEventSnapshot {
  return {
    id: event.id,
    participantId: event.participantId,
    type: event.type,
    amount: event.amount,
    street: event.street,
    timestamp: event.timestamp.toISOString(),
  };
}

function serializeHand(hand: Hand): HandSnapshot {
  return {
    id: hand.id,
    handNumber: hand.handNumber,
    status: hand.status,
    street: hand.street,
    dealerParticipant: hand.order[hand.dealerIndex].id,
    smallBlindParticipant: hand.smallBlindId,
    bigBlindParticipant: hand.bigBlindId,
    pots: hand.pots().map(serializePot),
    betting: {
      activeParticipant: hand.betting.actor?.id ?? null,
      currentBet: hand.betting.currentBet,
      minRaiseTo: hand.betting.minRaiseTo,
      committed: Object.fromEntries(hand.betting.committed),
      legalActions: hand.legalActions(),
    },
    events: hand.events.map(serializeEvent),
  };
}

/**
 * The runtime aggregate knows nothing of the join code (an ephemeral Redis
 * concern), the session name (a DB column), whether another seat may be opened
 * (half a plan question), or the resolved participant fields; callers finish
 * all of them when the snapshot crosses into REST/WebSocket responses.
 */
export type RuntimeSnapshot = Omit<
  GameSnapshot,
  'joinCode' | 'name' | 'participants' | 'canAddSeat'
> & {
  participants: RawParticipantSnapshot[];
};

export function serializeSession(
  id: string,
  session: GameSession,
): RuntimeSnapshot {
  const { rules } = session.config;
  const stakes: TableStakes = {
    blinds: rules.blinds,
    ante: rules.ante,
    bettingStructure: rules.bettingStructure,
  };

  return {
    id,
    mode: session.config.mode,
    status: session.status,
    stakes,
    chipModel: rules.chipModel,
    participants: session.seats.map(serializeParticipant),
    currentHand: session.currentHand
      ? serializeHand(session.currentHand)
      : null,
  };
}

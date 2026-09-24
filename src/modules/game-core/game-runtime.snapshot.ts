import type { Action } from '@modules/game-core/free/action';
import type { FreeSession } from '@modules/game-core/free/free-session';
import type { Pot } from '@modules/game-core/free/pot';
import type { Round } from '@modules/game-core/free/round';
import type { Hand } from '@modules/game-core/poker/hand';
import type { HandEvent } from '@modules/game-core/poker/hand-event';
import type { PokerSession } from '@modules/game-core/poker/poker-session';
import type { PotLayer } from '@modules/game-core/poker/pots';
import type { GameSession } from '@modules/game-core/runtime/game-session';
import type { Participant } from '@modules/game-core/runtime/participant';
import {
  GameMode,
  type ActionSnapshot,
  type GameSnapshot,
  type HandEventSnapshot,
  type HandSnapshot,
  type ParticipantSnapshot,
  type PotSnapshot,
  type RoundSnapshot,
  type TableStakes,
} from '@tokenizer/shared/types';

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

function serializePotLayer(pot: PotLayer): PotSnapshot {
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
    pots: hand.pots().map(serializePotLayer),
    betting: {
      activeParticipant: hand.betting.actor?.id ?? null,
      nextParticipant: hand.betting.nextActor?.id ?? null,
      currentBet: hand.betting.currentBet,
      minRaiseTo: hand.betting.minRaiseTo,
      committed: Object.fromEntries(hand.betting.committed),
      legalActions: hand.legalActions(),
    },
    events: hand.events.map(serializeEvent),
  };
}

function serializeFreePot(pot: Pot): PotSnapshot {
  return {
    id: pot.id,
    amount: pot.amount,
    eligibleParticipants: [...pot.eligibleParticipants],
    isSidePot: false,
  };
}

function serializeAction(action: Action): ActionSnapshot {
  return {
    id: action.id,
    participantId: action.participantId,
    definitionId: action.definitionId,
    amount: action.amount,
    timestamp: action.timestamp.toISOString(),
  };
}

function serializeRound(round: Round): RoundSnapshot {
  return {
    id: round.id,
    status: round.status,
    pots: round.pots.map(serializeFreePot),
    turn: {
      activeParticipant: round.turnState.activeParticipant,
      nextParticipant: round.turnState.nextParticipant,
      interruptionOpen: round.turnState.interruptionOpen,
      pendingClaims: round.turnState.pendingClaims.length,
      legalActions: round.turnState.computeLegalActions(),
    },
    actionLog: round.actionLog.map(serializeAction),
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type RuntimeSnapshot = DistributiveOmit<
  GameSnapshot,
  'joinCode' | 'name' | 'participants' | 'canAddSeat'
> & {
  participants: RawParticipantSnapshot[];
};

export function serializeSession(
  id: string,
  session: GameSession,
): RuntimeSnapshot {
  const participants = session.seats.map(serializeParticipant);

  if (session.config.mode === GameMode.Poker) {
    const poker = session as PokerSession;
    const { rules } = poker.config;
    const stakes: TableStakes = {
      blinds: rules.blinds,
      ante: rules.ante,
      bettingStructure: rules.bettingStructure,
    };

    return {
      id,
      mode: GameMode.Poker,
      status: poker.status,
      stakes,
      chipModel: rules.chipModel,
      dealsPlayed: poker.dealsPlayed,
      participants,
      currentHand: poker.currentHand ? serializeHand(poker.currentHand) : null,
    };
  }

  const free = session as FreeSession;
  return {
    id,
    mode: GameMode.Free,
    status: free.status,
    chipModel: free.config.economy.chipModel,
    dealsPlayed: free.dealsPlayed,
    participants,
    currentRound: free.currentRound ? serializeRound(free.currentRound) : null,
  };
}

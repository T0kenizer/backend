import type { ParticipantRole } from '@tokenizer/shared/types';

/**
 * Internal runtime claim params. `holderId` is the module's own notion of who
 * occupies a seat — a user uuid when signed in, an opaque anonymous id
 * otherwise. It stays inside the module: what a client presents is a signed
 * token, and what the room sees is a boolean.
 */
export interface ClaimParams {
  holderId: string;
  /** Explicit override; omit to fall back to the account/config default. */
  displayName?: string;
  /** Seat to claim; omit to take the first free seat. */
  seatIndex?: number;
}

/** Internal runtime update params; the seat is the caller's own. */
export interface UpdateSeatParams {
  participantId: string;
  /** Null clears the override, undefined leaves it unchanged. */
  displayName?: Nullable<string>;
}

export interface AddSeatParams {
  id: string;
  displayName: string;
  initialBalance?: number;
}

/**
 * Initial state of a seat, read from the persisted `GameParticipant` rows and
 * used to (re)build the in-memory aggregate when a room opens.
 */
export interface SeatInit {
  /** The persisted `GameParticipant` uuid — shared with the runtime. */
  id: string;
  seatIndex: number;
  role: ParticipantRole;
  displayNameOverride: Nullable<string>;
  balance: number;
  /** Identity occupying the seat; null while the seat is free. */
  controller: Nullable<string>;
}

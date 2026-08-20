import type { ParticipantRole } from '@tokenizer/shared/types';

/**
 * Internal runtime claim params (payloads are validated upstream by the shared
 * `claimSeatDataSchema`).
 */
export interface ClaimParams {
  /** External identity: authenticated user UUID or an anonymous client id. */
  externalId: string;
  /** Explicit override; omit to fall back to the account/config default. */
  displayName?: string;
  /** Whether an explicit photo override was captured (bytes live in Redis). */
  hasPhoto?: boolean;
  /** Seat to claim; omitted to take the first free seat. */
  seatIndex?: number;
}

/**
 * Internal runtime update params (payloads are validated upstream by the shared
 * `updateSeatDataSchema`). Renaming/re-photoing a seat is only allowed for
 * whoever already controls it.
 */
export interface UpdateSeatParams {
  externalId: string;
  /** Null clears the override, undefined leaves it unchanged. */
  displayName?: Nullable<string>;
  /** Null clears the photo override, undefined leaves it unchanged. */
  hasPhoto?: Nullable<boolean>;
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
  hasPhotoOverride: boolean;
  balance: number;
  /** External identity occupying the seat; null while the seat is free. */
  controller: Nullable<string>;
}

/** Redis payload mapping a connected socket to its game room. */
export interface SocketBinding {
  joinCode: string;
  externalId: string;
}

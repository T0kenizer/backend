import {
  ParticipantStatus,
  type ParticipantRole,
} from '@tokenizer/shared/types';

export interface ParticipantParams {
  /** The persisted `GameParticipant` uuid — shared with the database row. */
  id: string;
  seatIndex: number;
  role: ParticipantRole;
  /**
   * Explicit override; null means "no override" — display falls back to the
   * claiming account's name, then the config's default seat name (resolved
   * outside the runtime, which has no DB access).
   */
  displayNameOverride: Nullable<string>;
  balance: number;
  controller: Nullable<string>;
}

/**
 * A seat of the session. Seats exist from the session's creation; an unclaimed
 * seat waits (`WAITING`, no controller) until a player claims it.
 */
export class Participant {
  readonly id: string;
  readonly seatIndex: number;
  readonly role: ParticipantRole;
  displayNameOverride: Nullable<string>;
  balance: number;
  status: ParticipantStatus;
  /**
   * Who holds the seat: a user uuid when signed in, an opaque anonymous id
   * otherwise. Internal to the module — it is never serialized into a snapshot,
   * because a snapshot goes to everyone in the room.
   */
  controller: Nullable<string>;

  constructor(params: ParticipantParams) {
    this.id = params.id;
    this.seatIndex = params.seatIndex;
    this.role = params.role;
    this.displayNameOverride = params.displayNameOverride;
    this.balance = params.balance;
    this.controller = params.controller;
    this.status = params.controller
      ? ParticipantStatus.Active
      : ParticipantStatus.Waiting;
  }

  get claimed(): boolean {
    return this.controller !== null;
  }

  /**
   * Occupies the seat. `displayName` is only set when explicitly provided —
   * otherwise the seat keeps falling back to the account/config default,
   * resolved at snapshot time.
   */
  claim(holderId: string, displayName?: string): void {
    this.controller = holderId;
    if (displayName !== undefined) this.displayNameOverride = displayName;
    if (this.status === ParticipantStatus.Waiting) {
      this.status = ParticipantStatus.Active;
    }
  }

  /**
   * Renames the seat. `undefined` leaves it unchanged; `null` clears the
   * override (falls back to the account/config default again).
   */
  update(displayName?: Nullable<string>): void {
    if (displayName !== undefined) this.displayNameOverride = displayName;
  }
}

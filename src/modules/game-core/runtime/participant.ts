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
  /** Whether an explicit photo override is stored (bytes live in Redis). */
  hasPhotoOverride: boolean;
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
  hasPhotoOverride: boolean;
  balance: number;
  status: ParticipantStatus;
  /** External identity controlling the seat; null while unclaimed. */
  controller: Nullable<string>;

  constructor(params: ParticipantParams) {
    this.id = params.id;
    this.seatIndex = params.seatIndex;
    this.role = params.role;
    this.displayNameOverride = params.displayNameOverride;
    this.hasPhotoOverride = params.hasPhotoOverride;
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
   * Occupies the seat. `displayName`/`hasPhoto` are only set when explicitly
   * provided — otherwise the seat keeps falling back to the account/config
   * default, resolved at snapshot time.
   */
  claim(externalId: string, displayName?: string, hasPhoto?: boolean): void {
    this.controller = externalId;
    if (displayName !== undefined) this.displayNameOverride = displayName;
    if (hasPhoto !== undefined) this.hasPhotoOverride = hasPhoto;
    if (this.status === ParticipantStatus.Waiting) {
      this.status = ParticipantStatus.Active;
    }
  }

  /**
   * Renames/re-photos the seat. `undefined` fields are left unchanged; `null`
   * clears the override (falls back to the account/config default again).
   */
  update(displayName?: Nullable<string>, hasPhoto?: Nullable<boolean>): void {
    if (displayName !== undefined) this.displayNameOverride = displayName;
    if (hasPhoto !== undefined) this.hasPhotoOverride = hasPhoto ?? false;
  }
}

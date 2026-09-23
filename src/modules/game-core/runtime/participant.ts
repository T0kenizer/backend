import {
  ParticipantStatus,
  type ParticipantRole,
} from '@tokenizer/shared/types';

export interface ParticipantParams {
  id: string;
  seatIndex: number;
  role: ParticipantRole;
  displayNameOverride: Nullable<string>;
  balance: number;
  controller: Nullable<string>;
}
export class Participant {
  readonly id: string;
  readonly seatIndex: number;
  readonly role: ParticipantRole;
  displayNameOverride: Nullable<string>;
  balance: number;
  status: ParticipantStatus;
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

  claim(holderId: string, displayName?: string): void {
    this.controller = holderId;
    if (displayName !== undefined) this.displayNameOverride = displayName;
    if (this.status === ParticipantStatus.Waiting) {
      this.status = ParticipantStatus.Active;
    }
  }

  update(displayName?: Nullable<string>): void {
    if (displayName !== undefined) this.displayNameOverride = displayName;
  }
}

import type { ParticipantRole } from '@tokenizer/shared/types';

export interface ClaimParams {
  holderId: string;
  displayName?: string;
  seatIndex?: number;
}

export interface UpdateSeatParams {
  participantId: string;
  displayName?: Nullable<string>;
}

export interface AddSeatParams {
  id: string;
  displayName: string;
  initialBalance?: number;
}

export interface SeatInit {
  id: string;
  seatIndex: number;
  role: ParticipantRole;
  displayNameOverride: Nullable<string>;
  balance: number;
  controller: Nullable<string>;
}

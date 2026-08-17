import type {
  ControllerIdentifier,
  ParticipantId,
} from '@modules/game-core/game-core.types';
import { ParticipantStatus } from '@tokenizer/shared/types';

export interface ParticipantParams {
  displayName: string;
  balance: number;
  seatIndex: number;
  controller: ControllerIdentifier;
}

export class Participant {
  readonly id: ParticipantId;
  displayName: string;
  balance: number;
  readonly seatIndex: number;
  status: ParticipantStatus;

  controller: ControllerIdentifier;

  constructor(params: ParticipantParams) {
    this.id = crypto.randomUUID();
    this.displayName = params.displayName;
    this.balance = params.balance;
    this.seatIndex = params.seatIndex;
    this.status = ParticipantStatus.Active;
    this.controller = params.controller;
  }
}

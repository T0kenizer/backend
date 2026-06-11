import type { ControllerIdentifier, ParticipantId } from '../types';

export enum ParticipantStatus {
  ACTIVE = 'ACTIVE',
  FOLDED = 'FOLDED',
  ELIMINATED = 'ELIMINATED',
  WAITING = 'WAITING',
}

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
    this.status = ParticipantStatus.ACTIVE;
    this.controller = params.controller;
  }
}

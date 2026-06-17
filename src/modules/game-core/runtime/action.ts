import type {
  ActionId,
  ParticipantId,
} from '@modules/game-core/game-core.types';

export interface ActionParams {
  participantId: ParticipantId;
  definitionId: string;
  amount?: number;
}

export class Action {
  readonly id: ActionId;
  readonly participantId: ParticipantId;
  readonly definitionId: string;
  readonly amount?: number;
  readonly timestamp: Date;

  constructor(params: ActionParams) {
    this.id = crypto.randomUUID();
    this.participantId = params.participantId;
    this.definitionId = params.definitionId;
    this.amount = params.amount;
    this.timestamp = new Date();
    Object.freeze(this);
  }
}

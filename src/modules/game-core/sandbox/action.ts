export interface ActionParams {
  participantId: string;
  definitionId: string;
  amount?: number;
}

export class Action {
  readonly id: string;
  readonly participantId: string;
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

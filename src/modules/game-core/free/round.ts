import type { ActionParams } from '@modules/game-core/free/action';
import { Action } from '@modules/game-core/free/action';
import { Pot } from '@modules/game-core/free/pot';
import { TurnState } from '@modules/game-core/free/turn-state';
import { Participant } from '@modules/game-core/runtime/participant';
import { BadRequestException } from '@nestjs/common';
import {
  AmountForm,
  ParticipantStatus,
  RoundStatus,
  type FreeGameConfig,
} from '@tokenizer/shared/types';

export class Round {
  readonly id: string;
  status: RoundStatus;
  readonly pots: Pot[];
  readonly turnState: TurnState;
  readonly actionLog: Action[];

  private readonly config: FreeGameConfig;
  private readonly participants: Participant[];

  constructor(config: FreeGameConfig, orderedParticipants: Participant[]) {
    this.id = crypto.randomUUID();
    this.status = RoundStatus.Init;
    this.config = config;
    this.participants = orderedParticipants;
    this.actionLog = [];

    this.pots = [new Pot(orderedParticipants.map((p) => p.id))];
    this.turnState = new TurnState(
      config.turnPolicy,
      config.actionCatalog,
      orderedParticipants,
    );
  }

  applyForcedBets(): void {
    for (const fb of this.config.economy.forcedBets) {
      const participant =
        this.participants[fb.seatOffset % this.participants.length];
      if (!participant) continue;

      const amount = Math.min(fb.amount, participant.balance);
      participant.balance -= amount;
      this.mainPot.addContribution(participant.id, amount);

      this.actionLog.push(
        new Action({
          participantId: participant.id,
          definitionId: `__forced:${fb.label}`,
          amount,
        }),
      );
    }

    this.status = RoundStatus.InProgress;
  }

  submitAction(params: ActionParams): Action {
    if (this.status !== RoundStatus.InProgress) {
      throw new BadRequestException(
        `Cannot submit action — round is ${this.status}`,
      );
    }

    const def = this.config.actionCatalog.find(
      (d) => d.id === params.definitionId,
    );
    if (!def) {
      throw new BadRequestException(
        `Unknown action definition: "${params.definitionId}"`,
      );
    }

    const participant = this.participants.find(
      (p) => p.id === params.participantId,
    );
    if (!participant) {
      throw new BadRequestException('Participant is not part of this round');
    }

    if (this.turnState.interruptionOpen) {
      if (!def.grantsInterruption) {
        throw new BadRequestException(
          'An interruption window is open — only interrupting actions are legal',
        );
      }
      this.turnState.addClaim({
        participantId: params.participantId,
        definitionId: params.definitionId,
        claimedAt: new Date(),
      });
      const action = new Action(params);
      this.actionLog.push(action);
      return action;
    }

    if (this.turnState.activeParticipant !== params.participantId) {
      throw new BadRequestException(
        `It is not participant ${params.participantId}'s turn`,
      );
    }

    if (def.amountForm !== AmountForm.None && params.amount === undefined) {
      throw new BadRequestException(
        `Action "${def.id}" requires an amount (amountForm: ${def.amountForm})`,
      );
    }

    const action = new Action(params);

    if (params.amount !== undefined && params.amount > 0) {
      const capped = Math.min(params.amount, participant.balance);
      participant.balance -= capped;
      this.mainPot.addContribution(participant.id, capped);
    }

    if (def.foldsParticipant) {
      participant.status = ParticipantStatus.Folded;
    }

    this.actionLog.push(action);

    if (def.grantsInterruption) {
      if (!this.turnState.openInterruptionWindow()) this.turnState.advance();
    } else {
      this.turnState.advance();
    }

    return action;
  }

  contenders(): Participant[] {
    return this.participants.filter(
      (p) => p.status === ParticipantStatus.Active,
    );
  }

  resolve(winnerIds: string[] = []): void {
    if (this.status === RoundStatus.Resolved) return;
    this.turnState.closeInterruptionWindow();

    for (const pot of this.pots) {
      const eligibleWinners = winnerIds
        .map((id) => this.participants.find((p) => p.id === id))
        .filter(
          (p): p is Participant =>
            p !== undefined && pot.eligibleParticipants.includes(p.id),
        );
      pot.payOut(eligibleWinners);
    }

    this.status = RoundStatus.Resolved;
  }

  private get mainPot(): Pot {
    return this.pots[0];
  }
}

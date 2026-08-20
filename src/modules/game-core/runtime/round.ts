import type { ActionParams } from '@modules/game-core/runtime/action';
import { Action } from '@modules/game-core/runtime/action';
import { Participant } from '@modules/game-core/runtime/participant';
import { Pot } from '@modules/game-core/runtime/pot';
import { TurnState } from '@modules/game-core/runtime/turn-state';
import { BadRequestException } from '@nestjs/common';
import {
  AmountForm,
  ParticipantStatus,
  RoundStatus,
  type GameConfig,
} from '@tokenizer/shared/types';

export class Round {
  readonly id: string;
  status: RoundStatus;
  readonly pots: Pot[];
  readonly turnState: TurnState;
  /** Append-only ordered event log */
  readonly actionLog: Action[];

  private readonly config: GameConfig;
  /** Seat-ordered participants of this round (claimed, not eliminated). */
  private readonly participants: Participant[];

  constructor(config: GameConfig, orderedParticipants: Participant[]) {
    this.id = crypto.randomUUID();
    this.status = RoundStatus.Init;
    this.config = config;
    this.participants = orderedParticipants;
    this.actionLog = [];

    // A single main pot; side pots (MULTIPLE_SIDEPOTS) will be created
    // dynamically as all-ins occur — not implemented in v0.
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

      // Forced bets are logged with a synthetic definition id
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

    // While an interruption window is open, the only legal move — for anyone,
    // active participant included — is to compete for the turn with an
    // interrupting action. Normal actions would advance the rotation and
    // silently discard the pending claims.
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

    // Validate amount against the action definition
    if (def.amountForm !== AmountForm.None && params.amount === undefined) {
      throw new BadRequestException(
        `Action "${def.id}" requires an amount (amountForm: ${def.amountForm})`,
      );
    }

    const action = new Action(params);

    // Move chips if an amount is provided
    if (params.amount !== undefined && params.amount > 0) {
      const capped = Math.min(params.amount, participant.balance);
      participant.balance -= capped;
      this.mainPot.addContribution(participant.id, capped);
    }

    // Actions flagged as folding remove the participant from the round before
    // the turn advances, so rotation and end conditions skip them.
    if (def.foldsParticipant) {
      participant.status = ParticipantStatus.Folded;
    }

    this.actionLog.push(action);

    if (def.grantsInterruption) {
      const opened = this.turnState.openInterruptionWindow(() => {
        // Auto-resolve on window expiry if no claims arrived
        if (this.turnState.pendingClaims.length > 0) {
          this.turnState.resolveClaims();
        } else {
          this.turnState.advance();
        }
      });
      // Regimes without interruptions rotate normally.
      if (!opened) this.turnState.advance();
    } else {
      this.turnState.advance();
    }

    return action;
  }

  /**
   * Participants still contesting the round (not folded, not eliminated).
   * Seat-ordered.
   */
  contenders(): Participant[] {
    return this.participants.filter(
      (p) => p.status === ParticipantStatus.Active,
    );
  }

  /**
   * Settles the round: every pot is emptied into its eligible winners' balances
   * (split equally, remainder to the earliest seat). Idempotent.
   */
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

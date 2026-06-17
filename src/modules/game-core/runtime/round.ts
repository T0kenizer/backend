import { AmountForm } from '@modules/game-core/config/action-def';
import { PotMode } from '@modules/game-core/config/economy-policy';
import type { GameConfig } from '@modules/game-core/config/game-config';
import type {
  ParticipantId,
  RoundId,
} from '@modules/game-core/game-core.types';
import type { ActionParams } from '@modules/game-core/runtime/action';
import { Action } from '@modules/game-core/runtime/action';
import {
  Participant,
  ParticipantStatus,
} from '@modules/game-core/runtime/participant';
import { Pot } from '@modules/game-core/runtime/pot';
import { TurnState } from '@modules/game-core/runtime/turn-state';

export enum RoundStatus {
  INIT = 'INIT',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
}

export class Round {
  readonly id: RoundId;
  status: RoundStatus;
  readonly pots: Pot[];
  readonly turnState: TurnState;
  /** Append-only ordered event log */
  readonly actionLog: Action[];

  private readonly config: GameConfig;
  private readonly participantMap: Map<ParticipantId, Participant>;

  constructor(
    config: GameConfig,
    participantMap: Map<ParticipantId, Participant>,
    /** Seat-ordered participants for this round (excludes eliminated) */
    orderedParticipants: Participant[],
  ) {
    this.id = crypto.randomUUID();
    this.status = RoundStatus.INIT;
    this.config = config;
    this.participantMap = participantMap;
    this.actionLog = [];

    this.pots = this.initPots(orderedParticipants.map((p) => p.id));
    this.turnState = new TurnState(
      config.turnPolicy,
      config.actionCatalog,
      orderedParticipants,
    );
  }

  private initPots(participantIds: ParticipantId[]): Pot[] {
    if (this.config.economy.potMode === PotMode.SINGLE) {
      return [new Pot(participantIds)];
    }
    // MULTIPLE_SIDEPOTS: start with a single main pot; side pots are added
    // dynamically as all-ins occur (not implemented in v0).
    return [new Pot(participantIds)];
  }

  applyForcedBets(): void {
    const { forcedBets } = this.config.economy;
    const ordered = [...this.participantMap.values()]
      .filter((p) => p.status !== ParticipantStatus.ELIMINATED)
      .sort((a, b) => a.seatIndex - b.seatIndex);

    for (const fb of forcedBets) {
      const participant = ordered[fb.seatOffset % ordered.length];
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

    this.status = RoundStatus.IN_PROGRESS;
  }

  submitAction(params: ActionParams): Action {
    if (this.status !== RoundStatus.IN_PROGRESS) {
      throw new Error(`Cannot submit action — round is ${this.status}`);
    }

    const def = this.config.actionCatalog.find(
      (d) => d.id === params.definitionId,
    );
    if (!def) {
      throw new Error(`Unknown action definition: "${params.definitionId}"`);
    }

    const isActiveTurn =
      this.turnState.activeParticipant === params.participantId;

    if (!isActiveTurn) {
      if (!this.turnState.interruptionOpen || !def.grantsInterruption) {
        throw new Error(`It is not participant ${params.participantId}'s turn`);
      }
      // Register as a competing claim during the interruption window
      this.turnState.addClaim({
        participantId: params.participantId,
        definitionId: params.definitionId,
        claimedAt: new Date(),
      });
      const action = new Action(params);
      this.actionLog.push(action);
      return action;
    }

    // Validate amount against the action definition
    if (def.amountForm !== AmountForm.NONE && params.amount === undefined) {
      throw new Error(
        `Action "${def.id}" requires an amount (amountForm: ${def.amountForm})`,
      );
    }

    const action = new Action(params);

    // Move chips if an amount is provided
    if (params.amount !== undefined && params.amount > 0) {
      const participant = this.participantMap.get(params.participantId);
      if (!participant) throw new Error('Participant not found');

      const capped = Math.min(params.amount, participant.balance);
      participant.balance -= capped;
      this.mainPot.addContribution(participant.id, capped);
    }

    this.actionLog.push(action);

    if (def.grantsInterruption) {
      this.turnState.openInterruptionWindow(() => {
        // Auto-resolve on window expiry if no claims arrived
        if (this.turnState.pendingClaims.length > 0) {
          this.turnState.resolveClaims();
        } else {
          this.turnState.advance();
        }
      });
    } else {
      this.turnState.advance();
    }

    return action;
  }

  resolve(): void {
    if (this.status === RoundStatus.RESOLVED) return;
    this.turnState.closeInterruptionWindow();
    // AUTOMATIC resolution hooks would run here in future iterations
    this.status = RoundStatus.RESOLVED;
  }

  private get mainPot(): Pot {
    return this.pots[0];
  }
}

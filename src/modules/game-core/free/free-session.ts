import { Round } from '@modules/game-core/free/round';
import { GameSession } from '@modules/game-core/runtime/game-session';
import type { Participant } from '@modules/game-core/runtime/participant';
import { BadRequestException } from '@nestjs/common';
import { MIN_SEATS } from '@tokenizer/shared/constants/games.constants';
import {
  EndResolution,
  GameMode,
  GameSessionStatus,
  ParticipantStatus,
  RoundStatus,
  type FreeGameConfig,
  type RoundResolution,
} from '@tokenizer/shared/types';

export class FreeSession extends GameSession<FreeGameConfig> {
  currentRound?: Round;
  roundsPlayed = 0;

  /** Whether a round is open right now. */
  get dealInProgress(): boolean {
    return (
      this.currentRound !== undefined &&
      this.currentRound.status !== RoundStatus.Resolved
    );
  }

  protected get dealNoun(): string {
    return 'round';
  }

  get dealsPlayed(): number {
    return this.roundsPlayed;
  }

  startRound(): Round {
    this.assertNotFinished();
    if (this.dealInProgress) {
      throw new BadRequestException(
        'Resolve the current round before starting a new one',
      );
    }

    const contenders = this.seats.filter(
      (p) => p.status !== ParticipantStatus.Eliminated,
    );
    if (contenders.length < MIN_SEATS) {
      throw new BadRequestException(
        `At least ${MIN_SEATS} non-eliminated seats are required`,
      );
    }

    this.startPlaying();

    for (const seat of contenders) {
      if (
        seat.status === ParticipantStatus.Folded ||
        seat.status === ParticipantStatus.Waiting
      ) {
        seat.status = ParticipantStatus.Active;
      }
    }

    this.roundsPlayed += 1;

    const round = new Round(this.config, contenders);
    round.applyForcedBets();
    this.currentRound = round;
    return round;
  }

  submitAction(
    participant: Participant,
    definitionId: string,
    amount?: number,
  ): Optional<RoundResolution> {
    const round = this.currentRound;
    if (!round) throw new BadRequestException('No round is in progress');

    round.submitAction({ participantId: participant.id, definitionId, amount });
    return this.evaluateEndConditions();
  }

  resolveRound(winnerParticipantIds: string[] = []): RoundResolution {
    const round = this.currentRound;
    if (!round || round.status !== RoundStatus.InProgress) {
      throw new BadRequestException('No active round to resolve');
    }

    const winners = winnerParticipantIds.length
      ? winnerParticipantIds.map((id) => this.seatOrThrow(id).id)
      : round.contenders().map((p) => p.id);

    round.resolve(winners);
    return resolutionOf(round.id, 'MANUAL_HOST', winners);
  }

  closeSession(): void {
    this.currentRound?.resolve();
    this.status = GameSessionStatus.Finished;
  }

  private evaluateEndConditions(): Optional<RoundResolution> {
    const round = this.currentRound;
    if (!round || round.status !== RoundStatus.InProgress) return undefined;

    const { endPolicy } = this.config;
    if (endPolicy.resolution !== EndResolution.Automatic) return undefined;
    if (!endPolicy.conditions.some((c) => c.type === LAST_PLAYER_STANDING)) {
      return undefined;
    }

    const contenders = round.contenders();
    if (contenders.length > 1) return undefined;

    const winners = contenders.map((p) => p.id);
    round.resolve(winners);
    return resolutionOf(round.id, LAST_PLAYER_STANDING, winners);
  }
}

const LAST_PLAYER_STANDING = 'LAST_PLAYER_STANDING';

const resolutionOf = (
  roundId: string,
  reason: RoundResolution['reason'],
  winners: string[],
): RoundResolution => ({ mode: GameMode.Free, roundId, reason, winners });

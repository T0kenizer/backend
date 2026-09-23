import { FreeSession } from '@modules/game-core/free/free-session';
import type {
  AddSeatParams,
  ClaimParams,
  SeatInit,
  UpdateSeatParams,
} from '@modules/game-core/game-core.types';
import {
  serializeSession,
  type RuntimeSnapshot,
} from '@modules/game-core/game-runtime.snapshot';
import { PokerSession } from '@modules/game-core/poker/poker-session';
import { GameSession } from '@modules/game-core/runtime/game-session';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GameMode,
  GameSessionStatus,
  HandStatus,
  type GameConfig,
  type GameResolution,
  type HandResolution,
  type PotAward,
  type RoundResolution,
  type SubmitActionData,
} from '@tokenizer/shared/types';

@Injectable()
export class GameRuntimeService {
  private readonly logger = new Logger(GameRuntimeService.name);
  private readonly sessions = new Map<string, GameSession>();

  registerSession(
    gameId: string,
    config: GameConfig,
    ownerUuid: string,
    seats: SeatInit[],
  ): RuntimeSnapshot {
    if (this.sessions.has(gameId)) {
      throw new BadRequestException(`Game session ${gameId} is already open`);
    }
    const session =
      config.mode === GameMode.Poker
        ? new PokerSession(gameId, config, ownerUuid, seats)
        : new FreeSession(gameId, config, ownerUuid, seats);

    this.sessions.set(session.id, session);
    this.logger.log(`Opened game session ${session.id} (${config.mode})`);
    return this.snapshot(session.id);
  }

  hasSession(gameId: string): boolean {
    return this.sessions.has(gameId);
  }

  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  disposeSession(gameId: string): void {
    this.sessions.delete(gameId);
  }

  isFinished(gameId: string): boolean {
    return this.sessions.get(gameId)?.status === GameSessionStatus.Finished;
  }

  snapshot(gameId: string): RuntimeSnapshot {
    return serializeSession(gameId, this.getSessionOrThrow(gameId));
  }

  claimSeat(
    gameId: string,
    params: ClaimParams,
  ): { snapshot: RuntimeSnapshot; participantId: string } {
    const session = this.getSessionOrThrow(gameId);
    const seat = session.claimSeat(params);
    this.logger.log(`Seat ${seat.seatIndex} of ${gameId} claimed`);
    return { snapshot: this.snapshot(gameId), participantId: seat.id };
  }

  addSeat(
    gameId: string,
    params: AddSeatParams,
  ): { snapshot: RuntimeSnapshot; participantId: string } {
    const session = this.getSessionOrThrow(gameId);
    const seat = session.addSeat(params);
    this.logger.log(`Seat ${seat.seatIndex} added to ${gameId}`);
    return { snapshot: this.snapshot(gameId), participantId: seat.id };
  }

  canAddSeat(gameId: string): boolean {
    return this.getSessionOrThrow(gameId).canAddSeat;
  }

  assertCanAddSeat(gameId: string): void {
    this.getSessionOrThrow(gameId).assertCanAddSeat();
  }

  seatIndexOf(gameId: string, participantId: string): number {
    return this.getSessionOrThrow(gameId).seatOrThrow(participantId).seatIndex;
  }

  findSeatByHolder(gameId: string, holderId: string): Optional<string> {
    return this.getSessionOrThrow(gameId).seats.find(
      (p) => p.controller === holderId,
    )?.id;
  }

  updateSeat(
    gameId: string,
    params: UpdateSeatParams,
  ): { snapshot: RuntimeSnapshot; participantId: string } {
    const session = this.getSessionOrThrow(gameId);
    const seat = session.updateSeat(params);
    return { snapshot: this.snapshot(gameId), participantId: seat.id };
  }

  startHand(gameId: string): {
    snapshot: RuntimeSnapshot;
    resolution?: HandResolution;
  } {
    const session = this.pokerSessionOrThrow(gameId);
    const hand = session.startHand();
    this.logger.log(`Hand ${hand.handNumber} dealt in ${gameId}`);

    return {
      snapshot: this.snapshot(gameId),
      resolution: hand.resolution ?? undefined,
    };
  }

  startRound(gameId: string): { snapshot: RuntimeSnapshot } {
    const session = this.freeSessionOrThrow(gameId);
    const round = session.startRound();
    this.logger.log(`Round ${round.id} started in ${gameId}`);
    return { snapshot: this.snapshot(gameId) };
  }

  submitAction(
    gameId: string,
    callerParticipantId: string,
    params: SubmitActionData,
    isConnected: (participantId: string) => boolean,
  ): { snapshot: RuntimeSnapshot; resolution?: GameResolution } {
    const session = this.getSessionOrThrow(gameId);
    const participant = session.resolveActingParticipant(
      callerParticipantId,
      isConnected,
      params.targetParticipantId,
    );

    if (session instanceof PokerSession) {
      if (params.action === undefined) {
        throw new BadRequestException(
          'This table plays poker — name a poker action, not a catalog entry',
        );
      }
      const hand = session.currentHand;
      if (!hand) throw new BadRequestException('No hand is in progress');

      hand.submitAction(participant, params.action, params.amount);
      if (hand.resolution) {
        this.logger.log(
          `Hand ${hand.handNumber} of ${gameId} settled (${hand.resolution.reason})`,
        );
      }
      return {
        snapshot: this.snapshot(gameId),
        resolution: hand.resolution ?? undefined,
      };
    }

    const free = session as FreeSession;
    if (params.definitionId === undefined) {
      throw new BadRequestException(
        'This table plays its own rules — name an action from its catalog',
      );
    }

    const resolution = free.submitAction(
      participant,
      params.definitionId,
      params.amount,
    );
    if (resolution) {
      this.logger.log(
        `Round ${resolution.roundId} of ${gameId} resolved (${resolution.reason})`,
      );
    }
    return { snapshot: this.snapshot(gameId), resolution };
  }

  declareWinners(
    gameId: string,
    awards: PotAward[],
  ): { snapshot: RuntimeSnapshot; resolution: HandResolution } {
    const session = this.pokerSessionOrThrow(gameId);
    const hand = session.currentHand;
    if (!hand || hand.status === HandStatus.Settled) {
      throw new BadRequestException('No hand is waiting on a showdown');
    }

    const resolution = hand.declareWinners(awards);
    this.logger.log(`Hand ${hand.handNumber} of ${gameId} settled (showdown)`);
    return { snapshot: this.snapshot(gameId), resolution };
  }

  resolveRound(
    gameId: string,
    winnerParticipantIds: string[] = [],
  ): { snapshot: RuntimeSnapshot; resolution: RoundResolution } {
    const session = this.freeSessionOrThrow(gameId);
    const resolution = session.resolveRound(winnerParticipantIds);
    this.logger.log(
      `Round ${resolution.roundId} of ${gameId} resolved (${resolution.reason})`,
    );
    return { snapshot: this.snapshot(gameId), resolution };
  }

  closeSession(gameId: string): RuntimeSnapshot {
    const session = this.getSessionOrThrow(gameId);
    session.closeSession();
    const snapshot = this.snapshot(gameId);
    this.logger.log(`Closed game session ${gameId}`);
    return snapshot;
  }

  isHost(gameId: string, participantId: string): boolean {
    return this.getSessionOrThrow(gameId).isHost(participantId);
  }

  private getSessionOrThrow(gameId: string): GameSession {
    const session = this.sessions.get(gameId);
    if (!session)
      throw new NotFoundException(`Game session ${gameId} not found`);
    return session;
  }

  private pokerSessionOrThrow(gameId: string): PokerSession {
    const session = this.getSessionOrThrow(gameId);
    if (!(session instanceof PokerSession)) {
      throw new BadRequestException('This table is not playing poker');
    }
    return session;
  }

  private freeSessionOrThrow(gameId: string): FreeSession {
    const session = this.getSessionOrThrow(gameId);
    if (!(session instanceof FreeSession)) {
      throw new BadRequestException('This table is not playing its own rules');
    }
    return session;
  }
}

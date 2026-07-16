import { EndResolution } from '@modules/game-core/config/end-policy';
import type { GameConfig } from '@modules/game-core/config/game-config';
import type {
  GameSessionId,
  ParticipantId,
} from '@modules/game-core/game-core.types';
import { defaultGameConfig } from '@modules/game-core/game-runtime.presets';
import {
  serializeSession,
  type GameSnapshot,
} from '@modules/game-core/game-runtime.snapshot';
import { GameSession } from '@modules/game-core/runtime/game-session';
import type { Participant } from '@modules/game-core/runtime/participant';
import { RoundStatus } from '@modules/game-core/runtime/round';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';

const DEBUG_DIR = join(process.cwd(), 'debug');

export interface JoinParams {
  /** External identity: authenticated user UUID or an anonymous client id. */
  externalId: string;
  displayName: string;
  initialBalance: number;
}

export interface SubmitActionParams {
  externalId: string;
  definitionId: string;
  amount?: number;
}

/** Emitted whenever a round settles, so callers can broadcast the outcome. */
export interface RoundResolution {
  roundId: string;
  reason: 'LAST_PLAYER_STANDING' | 'MANUAL_HOST';
  winners: ParticipantId[];
  debugFile: string;
}

@Injectable()
export class GameRuntimeService {
  private readonly logger = new Logger(GameRuntimeService.name);
  private readonly sessions = new Map<GameSessionId, GameSession>();
  /** Per-session external-identity → participant id, for idempotent joins. */
  private readonly identities = new Map<
    GameSessionId,
    Map<string, ParticipantId>
  >();

  createSession(config?: GameConfig): GameSnapshot {
    const session = new GameSession(
      crypto.randomUUID(),
      config ?? defaultGameConfig(),
    );
    this.sessions.set(session.id, session);
    this.identities.set(session.id, new Map());
    this.logger.log(`Created game session ${session.id}`);
    return this.snapshot(session.id);
  }

  snapshot(gameId: GameSessionId): GameSnapshot {
    return serializeSession(gameId, this.getSessionOrThrow(gameId));
  }

  /**
   * Resolves an external identity to a participant, creating one on first
   * contact. Re-joining with the same external id returns the existing
   * participant (survives reconnects).
   */
  join(gameId: GameSessionId, params: JoinParams): GameSnapshot {
    const session = this.getSessionOrThrow(gameId);
    const registry = this.identities.get(gameId)!;

    const existingId = registry.get(params.externalId);
    if (existingId) return this.snapshot(gameId);

    const participant = session.addParticipant({
      displayName: params.displayName,
      initialBalance: params.initialBalance,
      controller: params.externalId,
    });
    registry.set(params.externalId, participant.id);
    this.logger.log(
      `Participant ${participant.id} (${params.externalId}) joined ${gameId}`,
    );
    return this.snapshot(gameId);
  }

  startRound(gameId: GameSessionId): GameSnapshot {
    const session = this.getSessionOrThrow(gameId);
    const round = session.startRound();
    round.applyForcedBets();
    this.logger.log(`Round ${round.id} started in ${gameId}`);
    return this.snapshot(gameId);
  }

  /**
   * Applies an action, then evaluates automatic end conditions. Returns the
   * fresh snapshot plus a resolution descriptor when the round terminated.
   */
  async submitAction(
    gameId: GameSessionId,
    params: SubmitActionParams,
  ): Promise<{ snapshot: GameSnapshot; resolution?: RoundResolution }> {
    const session = this.getSessionOrThrow(gameId);
    if (!session.currentRound) {
      throw new BadRequestException('No round is in progress');
    }

    const participantId = this.resolveParticipant(gameId, params.externalId);
    session.currentRound.submitAction({
      participantId,
      definitionId: params.definitionId,
      amount: params.amount,
    });

    const resolution = await this.evaluateEndConditions(gameId);
    return { snapshot: this.snapshot(gameId), resolution };
  }

  /** Host-driven termination for MANUAL_HOST end policies. */
  async resolveRound(
    gameId: GameSessionId,
    winnerExternalIds: string[] = [],
  ): Promise<{ snapshot: GameSnapshot; resolution: RoundResolution }> {
    const session = this.getSessionOrThrow(gameId);
    const round = session.currentRound;
    if (!round || round.status === RoundStatus.RESOLVED) {
      throw new BadRequestException('No active round to resolve');
    }

    const winners = winnerExternalIds.length
      ? winnerExternalIds.map((ext) => this.resolveParticipant(gameId, ext))
      : round.contenders().map((p) => p.id);

    round.resolve(winners);
    const resolution = await this.dumpRound(gameId, 'MANUAL_HOST', winners);
    return { snapshot: this.snapshot(gameId), resolution };
  }

  closeSession(gameId: GameSessionId): GameSnapshot {
    const session = this.getSessionOrThrow(gameId);
    session.closeSession();
    const snapshot = this.snapshot(gameId);
    this.logger.log(`Closed game session ${gameId}`);
    return snapshot;
  }

  resolveParticipant(gameId: GameSessionId, externalId: string): ParticipantId {
    const participantId = this.identities.get(gameId)?.get(externalId);
    if (!participantId) {
      throw new BadRequestException(
        `Unknown participant for identity "${externalId}"`,
      );
    }
    return participantId;
  }

  private getSessionOrThrow(gameId: GameSessionId): GameSession {
    const session = this.sessions.get(gameId);
    if (!session)
      throw new NotFoundException(`Game session ${gameId} not found`);
    return session;
  }

  /**
   * V0 automatic end condition: LAST_PLAYER_STANDING. When a single contender
   * remains, the round auto-resolves and the pot is awarded to the survivor.
   */
  private async evaluateEndConditions(
    gameId: GameSessionId,
  ): Promise<RoundResolution | undefined> {
    const session = this.getSessionOrThrow(gameId);
    const round = session.currentRound;
    if (!round || round.status !== RoundStatus.IN_PROGRESS) return undefined;

    const { endPolicy } = session.config;
    if (endPolicy.resolution !== EndResolution.AUTOMATIC) return undefined;

    const hasLastStanding = endPolicy.conditions.some(
      (c) => c.type === 'LAST_PLAYER_STANDING',
    );
    if (!hasLastStanding) return undefined;

    const contenders = round.contenders();
    if (contenders.length > 1) return undefined;

    const winners = contenders.map((p: Participant) => p.id);
    round.resolve(winners);
    return this.dumpRound(gameId, 'LAST_PLAYER_STANDING', winners);
  }

  /**
   * Writes a debug artefact for a resolved round. Persistence to the database
   * will replace this file dump later.
   */
  private async dumpRound(
    gameId: GameSessionId,
    reason: RoundResolution['reason'],
    winners: ParticipantId[],
  ): Promise<RoundResolution> {
    const snapshot = this.snapshot(gameId);
    const roundId = snapshot.currentRound?.id ?? 'unknown';
    const payload = {
      resolvedAt: new Date().toISOString(),
      reason,
      winners,
      game: snapshot,
    };

    await fs.mkdir(DEBUG_DIR, { recursive: true });
    const debugFile = join(DEBUG_DIR, `round-${roundId}.json`);
    await fs.writeFile(debugFile, JSON.stringify(payload, null, 2), 'utf-8');
    this.logger.log(`Round ${roundId} resolved (${reason}) → ${debugFile}`);

    return { roundId, reason, winners, debugFile };
  }
}

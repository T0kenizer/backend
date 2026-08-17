import type * as Types from '@modules/game-core/game-core.types';
import { defaultGameConfig } from '@modules/game-core/game-runtime.presets';
import { serializeSession } from '@modules/game-core/game-runtime.snapshot';
import { GameSession } from '@modules/game-core/runtime/game-session';
import type { Participant } from '@modules/game-core/runtime/participant';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EndResolution,
  RoundStatus,
  type GameConfig,
  type GameSnapshot,
  type RoundResolution,
  type SubmitActionData,
} from '@tokenizer/shared/types';
import { promises as fs } from 'fs';
import { join } from 'path';

const DEBUG_DIR = join(process.cwd(), 'debug');

@Injectable()
export class GameRuntimeService {
  private readonly logger = new Logger(GameRuntimeService.name);
  private readonly sessions = new Map<Types.GameSessionId, GameSession>();
  /** Per-session external-identity → participant id, for idempotent joins. */
  private readonly identities = new Map<
    Types.GameSessionId,
    Map<string, Types.ParticipantId>
  >();

  createSession(config?: GameConfig): GameSnapshot {
    return this.registerSession(crypto.randomUUID(), config);
  }

  /**
   * Registers a runtime session under an externally-supplied id — the DB
   * `GameSession` uuid — so the in-memory aggregate, the Socket.IO room and the
   * persisted row all share the same identifier.
   */
  registerSession(
    gameId: Types.GameSessionId,
    config?: GameConfig,
  ): GameSnapshot {
    if (this.sessions.has(gameId)) {
      throw new BadRequestException(`Game session ${gameId} is already open`);
    }
    const session = new GameSession(gameId, config ?? defaultGameConfig());
    this.sessions.set(session.id, session);
    this.identities.set(session.id, new Map());
    this.logger.log(`Created game session ${session.id}`);
    return this.snapshot(session.id);
  }

  hasSession(gameId: Types.GameSessionId): boolean {
    return this.sessions.has(gameId);
  }

  /** Drops the in-memory aggregate; persisted state is untouched. */
  disposeSession(gameId: Types.GameSessionId): void {
    this.sessions.delete(gameId);
    this.identities.delete(gameId);
  }

  snapshot(gameId: Types.GameSessionId): GameSnapshot {
    return serializeSession(gameId, this.getSessionOrThrow(gameId));
  }

  /**
   * Resolves an external identity to a participant, creating one on first
   * contact. Re-joining with the same external id returns the existing
   * participant (survives reconnects).
   */
  join(gameId: Types.GameSessionId, params: Types.JoinParams): GameSnapshot {
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

  startRound(gameId: Types.GameSessionId): GameSnapshot {
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
    gameId: Types.GameSessionId,
    params: SubmitActionData,
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
    gameId: Types.GameSessionId,
    winnerExternalIds: string[] = [],
  ): Promise<{ snapshot: GameSnapshot; resolution: RoundResolution }> {
    const session = this.getSessionOrThrow(gameId);
    const round = session.currentRound;
    if (!round || round.status === RoundStatus.Resolved) {
      throw new BadRequestException('No active round to resolve');
    }

    const winners = winnerExternalIds.length
      ? winnerExternalIds.map((ext) => this.resolveParticipant(gameId, ext))
      : round.contenders().map((p) => p.id);

    round.resolve(winners);
    const resolution = await this.dumpRound(gameId, 'MANUAL_HOST', winners);
    return { snapshot: this.snapshot(gameId), resolution };
  }

  closeSession(gameId: Types.GameSessionId): GameSnapshot {
    const session = this.getSessionOrThrow(gameId);
    session.closeSession();
    const snapshot = this.snapshot(gameId);
    this.logger.log(`Closed game session ${gameId}`);
    return snapshot;
  }

  resolveParticipant(
    gameId: Types.GameSessionId,
    externalId: string,
  ): Types.ParticipantId {
    const participantId = this.identities.get(gameId)?.get(externalId);
    if (!participantId) {
      throw new BadRequestException(
        `Unknown participant for identity "${externalId}"`,
      );
    }
    return participantId;
  }

  private getSessionOrThrow(gameId: Types.GameSessionId): GameSession {
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
    gameId: Types.GameSessionId,
  ): Promise<RoundResolution | undefined> {
    const session = this.getSessionOrThrow(gameId);
    const round = session.currentRound;
    if (!round || round.status !== RoundStatus.InProgress) return undefined;

    const { endPolicy } = session.config;
    if (endPolicy.resolution !== EndResolution.Automatic) return undefined;

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
    gameId: Types.GameSessionId,
    reason: RoundResolution['reason'],
    winners: Types.ParticipantId[],
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

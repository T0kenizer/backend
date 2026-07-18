import type { GameConfig } from '@modules/game-core/config/game-config';
import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/** Events the server emits into a game room. */
export const GameEvent = {
  STATE: 'game:state',
  PARTICIPANT_JOINED: 'game:participant_joined',
  ROUND_STARTED: 'game:round_started',
  ACTION_APPLIED: 'game:action_applied',
  ROUND_RESOLVED: 'game:round_resolved',
  SESSION_CLOSED: 'game:session_closed',
  ERROR: 'game:error',
} as const;

interface JoinPayload {
  gameId: string;
  externalId: string;
  displayName: string;
  initialBalance?: number;
}
interface CreatePayload {
  externalId: string;
  displayName: string;
  initialBalance?: number;
  config?: GameConfig;
}
interface ActionPayload {
  gameId: string;
  definitionId: string;
  amount?: number;
}
interface GamePayload {
  gameId: string;
}
interface ResolvePayload {
  gameId: string;
  winnerExternalIds?: string[];
}

/** Per-connection state stashed on `socket.data`. */
interface SocketState {
  externalId?: string;
  gameId?: string;
}

function stateOf(client: Socket): SocketState {
  return client.data as SocketState;
}

function room(gameId: string): string {
  return `game:${gameId}`;
}

/**
 * WebSocket transport for live gameplay. A client connects, joins a game room,
 * and drives the round via `game:action`. State is broadcast to every socket in
 * the room after each transition. This POC carries identity in the payload
 * (`externalId`); a hardened build would derive it from the session handshake.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameRuntimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GameRuntimeGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(private readonly runtime: GameRuntimeService) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Socket disconnected: ${client.id}`);
  }

  /** Create a fresh session and join it as the first participant (the host). */
  @SubscribeMessage('game:create')
  create(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CreatePayload,
  ) {
    return this.guard(client, () => {
      const created = this.runtime.createSession(payload.config);
      return this.doJoin(client, {
        gameId: created.id,
        externalId: payload.externalId,
        displayName: payload.displayName,
        initialBalance: payload.initialBalance,
      });
    });
  }

  @SubscribeMessage('game:join')
  join(@ConnectedSocket() client: Socket, @MessageBody() payload: JoinPayload) {
    return this.guard(client, () => this.doJoin(client, payload));
  }

  @SubscribeMessage('game:start_round')
  startRound(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: GamePayload,
  ) {
    return this.guard(client, () => {
      const snapshot = this.runtime.startRound(payload.gameId);
      this.broadcast(payload.gameId, GameEvent.ROUND_STARTED, snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage('game:action')
  async action(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ActionPayload,
  ) {
    return this.guardAsync(client, async () => {
      const externalId = this.identityOf(client);
      const { snapshot, resolution } = await this.runtime.submitAction(
        payload.gameId,
        {
          externalId,
          definitionId: payload.definitionId,
          amount: payload.amount,
        },
      );
      this.broadcast(payload.gameId, GameEvent.ACTION_APPLIED, snapshot);
      if (resolution) {
        this.broadcast(payload.gameId, GameEvent.ROUND_RESOLVED, {
          ...snapshot,
          resolution,
        });
      }
      return { snapshot, resolution };
    });
  }

  @SubscribeMessage('game:resolve')
  async resolve(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ResolvePayload,
  ) {
    return this.guardAsync(client, async () => {
      const { snapshot, resolution } = await this.runtime.resolveRound(
        payload.gameId,
        payload.winnerExternalIds,
      );
      this.broadcast(payload.gameId, GameEvent.ROUND_RESOLVED, {
        ...snapshot,
        resolution,
      });
      return { snapshot, resolution };
    });
  }

  @SubscribeMessage('game:snapshot')
  snapshot(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: GamePayload,
  ) {
    return this.guard(client, () => this.runtime.snapshot(payload.gameId));
  }

  @SubscribeMessage('game:close')
  close(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: GamePayload,
  ) {
    return this.guard(client, () => {
      const snapshot = this.runtime.closeSession(payload.gameId);
      this.broadcast(payload.gameId, GameEvent.SESSION_CLOSED, snapshot);
      return snapshot;
    });
  }

  private doJoin(client: Socket, payload: JoinPayload) {
    const snapshot = this.runtime.join(payload.gameId, {
      externalId: payload.externalId,
      displayName: payload.displayName,
      initialBalance: payload.initialBalance ?? 1000,
    });
    const state = stateOf(client);
    state.externalId = payload.externalId;
    state.gameId = payload.gameId;
    void client.join(room(payload.gameId));
    this.broadcast(payload.gameId, GameEvent.PARTICIPANT_JOINED, snapshot);
    return snapshot;
  }

  private identityOf(client: Socket): string {
    const externalId = stateOf(client).externalId;
    if (!externalId) {
      throw new Error('Socket has not joined a game (missing identity)');
    }
    return externalId;
  }

  private broadcast(gameId: string, event: string, payload: unknown): void {
    this.server.to(room(gameId)).emit(event, payload);
  }

  private guard<T>(client: Socket, fn: () => T): T | { error: string } {
    try {
      return fn();
    } catch (err) {
      return this.fail(client, err);
    }
  }

  private async guardAsync<T>(
    client: Socket,
    fn: () => Promise<T>,
  ): Promise<T | { error: string }> {
    try {
      return await fn();
    } catch (err) {
      return this.fail(client, err);
    }
  }

  private fail(client: Socket, err: unknown): { error: string } {
    const message = err instanceof Error ? err.message : 'Unknown error';
    this.logger.warn(`Gateway error for ${client.id}: ${message}`);
    client.emit(GameEvent.ERROR, { error: message });
    return { error: message };
  }
}

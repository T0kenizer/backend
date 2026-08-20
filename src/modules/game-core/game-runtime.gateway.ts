import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import { BadRequestException, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  GAME_CLIENT_MESSAGES,
  GAME_SERVER_EVENTS,
} from '@tokenizer/shared/constants/games.constants';
import {
  claimSeatDataSchema,
  gameConfigSchema,
  joinCodeSchema,
  resolveRoundDataSchema,
  updateSeatDataSchema,
} from '@tokenizer/shared/schemas';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

/**
 * Client payloads, validated with the shared schemas so the WebSocket transport
 * enforces the same contracts as the REST routes. Payloads identify the room by
 * its 6-character join code, not the DB uuid.
 */
const createPayloadSchema = z.object({
  // Creating a game persists an owned session: a real user uuid is required.
  externalId: z.uuid(),
  config: gameConfigSchema.optional(),
});
const joinPayloadSchema = claimSeatDataSchema.extend({
  joinCode: joinCodeSchema,
});
const gamePayloadSchema = z.object({ joinCode: joinCodeSchema });
const actionPayloadSchema = z.object({
  joinCode: joinCodeSchema,
  // Host only: acts on behalf of an unclaimed seat instead of the caller's own.
  targetParticipantId: z.uuid().optional(),
  definitionId: z.string().min(1),
  amount: z.number().int().nonnegative().optional(),
});
const resolvePayloadSchema = resolveRoundDataSchema.extend({
  joinCode: joinCodeSchema,
});
// Identity comes from the socket, not the payload — a client cannot rename
// another seat by supplying a different externalId.
const updateSeatPayloadSchema = updateSeatDataSchema
  .omit({ externalId: true })
  .extend({ joinCode: joinCodeSchema });

function parsePayload<Schema extends z.ZodType>(
  schema: Schema,
  payload: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`)
      .join('; ');
    throw new BadRequestException(message);
  }
  return result.data;
}

/** Per-connection state stashed on `socket.data`. */
interface SocketState {
  externalId?: string;
  joinCode?: string;
}

function stateOf(client: Socket): SocketState {
  return client.data as SocketState;
}

function room(joinCode: string): string {
  return `game:${joinCode}`;
}

/**
 * WebSocket transport for live gameplay. A client connects, claims a seat in a
 * game room, and drives the round via `game:action`. State is broadcast to
 * every socket in the room after each transition. Room lifecycle (lazy opening
 * from the DB, idle closure) and persistence are delegated to
 * `GameRoomsService`. This POC carries identity in the payload (`externalId`);
 * a hardened build would derive it from the session handshake.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameRuntimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GameRuntimeGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(private readonly rooms: GameRoomsService) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Socket disconnected: ${client.id}`);
    void this.rooms.unbindSocket(client.id).catch((err: Error) => {
      this.logger.error(`Failed to unbind socket ${client.id}: ${err.message}`);
    });
  }

  /**
   * Creates a fresh session owned by the caller. The host seat (seat 0) is
   * claimed at creation, so the socket only needs to be attached to the room.
   */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.CREATE)
  create(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(createPayloadSchema, payload);
      const snapshot = await this.rooms.createGame(
        data.externalId,
        data.config,
      );
      await this.attach(client, snapshot, data.externalId);
      this.broadcast(
        snapshot.joinCode,
        GAME_SERVER_EVENTS.PARTICIPANT_JOINED,
        snapshot,
      );
      return snapshot;
    });
  }

  @SubscribeMessage(GAME_CLIENT_MESSAGES.JOIN)
  join(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(joinPayloadSchema, payload);
      const gameId = await this.rooms.resolveGameId(data.joinCode);
      const snapshot = await this.rooms.claimSeat(gameId, data);
      await this.attach(client, snapshot, data.externalId);
      this.broadcast(
        data.joinCode,
        GAME_SERVER_EVENTS.PARTICIPANT_JOINED,
        snapshot,
      );
      return snapshot;
    });
  }

  /** Renames/re-photos the caller's own seat. */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.UPDATE_SEAT)
  updateSeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    return this.guard(client, async () => {
      const data = parsePayload(updateSeatPayloadSchema, payload);
      const gameId = await this.rooms.resolveGameId(data.joinCode);
      const snapshot = await this.rooms.updateSeat(gameId, {
        ...data,
        externalId: this.identityOf(client),
      });
      this.broadcast(
        data.joinCode,
        GAME_SERVER_EVENTS.PARTICIPANT_UPDATED,
        snapshot,
      );
      return snapshot;
    });
  }

  /** Host only. */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.START_ROUND)
  startRound(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    return this.guard(client, async () => {
      const data = parsePayload(gamePayloadSchema, payload);
      const gameId = await this.rooms.resolveGameId(data.joinCode);
      const snapshot = await this.rooms.startRound(
        gameId,
        this.identityOf(client),
      );
      this.broadcast(data.joinCode, GAME_SERVER_EVENTS.ROUND_STARTED, snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage(GAME_CLIENT_MESSAGES.ACTION)
  action(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(actionPayloadSchema, payload);
      const gameId = await this.rooms.resolveGameId(data.joinCode);
      const { snapshot, resolution } = await this.rooms.submitAction(gameId, {
        externalId: this.identityOf(client),
        targetParticipantId: data.targetParticipantId,
        definitionId: data.definitionId,
        amount: data.amount,
      });
      this.broadcast(
        data.joinCode,
        GAME_SERVER_EVENTS.ACTION_APPLIED,
        snapshot,
      );
      if (resolution) {
        this.broadcast(data.joinCode, GAME_SERVER_EVENTS.ROUND_RESOLVED, {
          ...snapshot,
          resolution,
        });
      }
      return { snapshot, resolution };
    });
  }

  /** Host only. */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.RESOLVE)
  resolve(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(resolvePayloadSchema, payload);
      const gameId = await this.rooms.resolveGameId(data.joinCode);
      const { snapshot, resolution } = await this.rooms.resolveRound(
        gameId,
        this.identityOf(client),
        data.winnerExternalIds,
      );
      this.broadcast(data.joinCode, GAME_SERVER_EVENTS.ROUND_RESOLVED, {
        ...snapshot,
        resolution,
      });
      return { snapshot, resolution };
    });
  }

  /** Fetching a snapshot lazily (re)opens the room from the persisted session. */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.SNAPSHOT)
  snapshot(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(gamePayloadSchema, payload);
      const gameId = await this.rooms.resolveGameId(data.joinCode);
      return this.rooms.ensureRoomOpen(gameId);
    });
  }

  /** Host only. */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.CLOSE)
  close(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(gamePayloadSchema, payload);
      const gameId = await this.rooms.resolveGameId(data.joinCode);
      const snapshot = await this.rooms.closeGame(
        gameId,
        this.identityOf(client),
      );
      this.broadcast(
        data.joinCode,
        GAME_SERVER_EVENTS.SESSION_CLOSED,
        snapshot,
      );
      return snapshot;
    });
  }

  /** Joins the Socket.IO room and registers the occupancy in Redis. */
  private async attach(
    client: Socket,
    snapshot: { joinCode: string },
    externalId: string,
  ): Promise<void> {
    const state = stateOf(client);
    state.externalId = externalId;
    state.joinCode = snapshot.joinCode;
    await client.join(room(snapshot.joinCode));
    await this.rooms.bindSocket(snapshot.joinCode, client.id, externalId);
  }

  private identityOf(client: Socket): string {
    const externalId = stateOf(client).externalId;
    if (!externalId) {
      throw new BadRequestException(
        'Socket has not joined a game (missing identity)',
      );
    }
    return externalId;
  }

  private broadcast(joinCode: string, event: string, payload: unknown): void {
    this.server.to(room(joinCode)).emit(event, payload);
  }

  private async guard<T>(
    client: Socket,
    fn: () => T | Promise<T>,
  ): Promise<T | { error: string }> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Gateway error for ${client.id}: ${message}`);
      client.emit(GAME_SERVER_EVENTS.ERROR, { error: message });
      return { error: message };
    }
  }
}

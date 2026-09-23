import {
  GamePresenceService,
  type GameSocketState,
} from '@modules/game-core/game-presence.service';
import { GameRoomsService } from '@modules/game-core/game-rooms.service';
import { GameTokensService } from '@modules/game-core/game-tokens.service';
import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  GAME_CLIENT_MESSAGES,
  GAME_SERVER_EVENTS,
} from '@tokenizer/shared/constants/games.constants';
import {
  attachSocketDataSchema,
  declareWinnersDataSchema,
  resolveRoundDataSchema,
  submitActionDataSchema,
  updateSeatDataSchema,
} from '@tokenizer/shared/schemas';
import { GameMode } from '@tokenizer/shared/types';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

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

/**
 * WebSocket transport for live gameplay.
 *
 * The socket carries no identity of its own and mints none. Creating a game and
 * taking a seat are authenticated HTTP calls; each hands back a signed player
 * token, and `game:attach` is the client replaying that token to bind this
 * connection to its seat. Every later message is authorised from what the
 * socket was bound to — never from its payload, which the client controls.
 *
 * Rooms are keyed by session uuid. The 6-digit code is resolved to a uuid
 * before any of this and never appears here: it is a lookup key for humans, not
 * a room name.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameRuntimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GameRuntimeGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly rooms: GameRoomsService,
    private readonly presence: GamePresenceService,
    private readonly tokens: GameTokensService,
  ) {}

  /** Presence reads the adapter, so it needs the server the moment it exists. */
  afterInit(server: Server): void {
    this.presence.bind(server);
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Socket connected: ${client.id}`);
  }

  /**
   * A dropped socket is not a departure. The room is asked what it looks like
   * _after_ this socket is gone — Socket.IO has already removed it by now — and
   * the grace periods take it from there.
   */
  handleDisconnect(client: Socket): void {
    const { gameUuid, participantId } = this.presence.stateOf(client);
    if (!gameUuid || !participantId) return;

    void this.rooms
      .onPlayerDisconnected(gameUuid, participantId)
      .catch((err: Error) => {
        this.logger.error(
          `Failed to handle disconnect for ${client.id}: ${err.message}`,
        );
      });
  }

  /**
   * Binds this socket to a room. The token is the only thing consulted: it
   * names the session and the seat, and it was signed by us.
   */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.ATTACH)
  attach(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(attachSocketDataSchema, payload);
      const { participantId } = this.tokens.verify(data.token, data.gameUuid);

      // Opening the room first means a token for a closed session is refused
      // before the socket is ever added to it.
      await this.rooms.ensureRoomOpen(data.gameUuid);
      await this.presence.attach(client, data.gameUuid, participantId);
      await this.rooms.onPlayerConnected(data.gameUuid, participantId);

      const snapshot = await this.rooms.ensureRoomOpen(data.gameUuid);
      this.broadcast(
        data.gameUuid,
        GAME_SERVER_EVENTS.PARTICIPANT_JOINED,
        snapshot,
      );
      // The seat comes back with the snapshot: a client returning from a
      // refresh learns which chair is its own without unpacking the token.
      return { snapshot, participantId };
    });
  }

  /** Renames the caller's own seat. */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.UPDATE_SEAT)
  updateSeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    return this.guard(client, async () => {
      const data = parsePayload(updateSeatDataSchema, payload);
      const { gameUuid, participantId } = this.boundState(client);
      const snapshot = await this.rooms.updateSeat(
        gameUuid,
        participantId,
        data,
      );
      this.broadcast(
        gameUuid,
        GAME_SERVER_EVENTS.PARTICIPANT_UPDATED,
        snapshot,
      );
      return snapshot;
    });
  }

  /**
   * Host only: deals the next hand.
   *
   * It can settle on the spot — antes and blinds alone can put every remaining
   * seat all-in — so the deal answers the same shape an action does, and the
   * table is told about the settlement rather than left showing a hand nobody
   * can act on.
   */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.START_HAND)
  startHand(@ConnectedSocket() client: Socket) {
    return this.guard(client, async () => {
      const { gameUuid, participantId } = this.boundState(client);
      const { snapshot, resolution } = await this.rooms.startHand(
        gameUuid,
        participantId,
      );
      this.broadcast(gameUuid, GAME_SERVER_EVENTS.HAND_STARTED, snapshot);
      if (resolution) {
        this.broadcast(gameUuid, GAME_SERVER_EVENTS.HAND_SETTLED, {
          ...snapshot,
          resolution,
        });
      }
      return { snapshot, resolution };
    });
  }

  /**
   * Host only, free mode: opens the next round.
   *
   * Broadcast on its own event rather than the hand's. The two lifecycles look
   * alike from here and are not the same thing at all — a round carries no
   * button, no streets and no showdown — and a client that had to read the
   * snapshot's mode to find out which one it just received would be doing the
   * work this event name already does.
   */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.START_ROUND)
  startRound(@ConnectedSocket() client: Socket) {
    return this.guard(client, async () => {
      const { gameUuid, participantId } = this.boundState(client);
      const snapshot = await this.rooms.startRound(gameUuid, participantId);
      this.broadcast(gameUuid, GAME_SERVER_EVENTS.ROUND_STARTED, snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage(GAME_CLIENT_MESSAGES.ACTION)
  action(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(submitActionDataSchema, payload);
      const { gameUuid, participantId } = this.boundState(client);
      const { snapshot, resolution } = await this.rooms.submitAction(
        gameUuid,
        participantId,
        data,
      );

      this.broadcast(gameUuid, GAME_SERVER_EVENTS.ACTION_APPLIED, snapshot);
      if (resolution) {
        // Which settlement event this is follows from the resolution itself:
        // it is discriminated on the same `mode` the snapshot is.
        this.broadcast(
          gameUuid,
          resolution.mode === GameMode.Poker
            ? GAME_SERVER_EVENTS.HAND_SETTLED
            : GAME_SERVER_EVENTS.ROUND_RESOLVED,
          { ...snapshot, resolution },
        );
      }
      return { snapshot, resolution };
    });
  }

  /** Host only: settles the showdown from the table's own verdict. */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.DECLARE_WINNERS)
  declareWinners(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    return this.guard(client, async () => {
      const data = parsePayload(declareWinnersDataSchema, payload ?? {});
      const { gameUuid, participantId } = this.boundState(client);
      const { snapshot, resolution } = await this.rooms.declareWinners(
        gameUuid,
        participantId,
        data.awards,
      );
      this.broadcast(gameUuid, GAME_SERVER_EVENTS.HAND_SETTLED, {
        ...snapshot,
        resolution,
      });
      return { snapshot, resolution };
    });
  }

  /** Host only, free mode: settles the round on the winners the table names. */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.RESOLVE)
  resolveRound(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    return this.guard(client, async () => {
      const data = parsePayload(resolveRoundDataSchema, payload ?? {});
      const { gameUuid, participantId } = this.boundState(client);
      const { snapshot, resolution } = await this.rooms.resolveRound(
        gameUuid,
        participantId,
        data.winnerParticipantIds,
      );
      this.broadcast(gameUuid, GAME_SERVER_EVENTS.ROUND_RESOLVED, {
        ...snapshot,
        resolution,
      });
      return { snapshot, resolution };
    });
  }

  @SubscribeMessage(GAME_CLIENT_MESSAGES.SNAPSHOT)
  snapshot(@ConnectedSocket() client: Socket) {
    return this.guard(client, async () => {
      const { gameUuid } = this.boundState(client);
      return this.rooms.ensureRoomOpen(gameUuid);
    });
  }

  /** Host only. */
  @SubscribeMessage(GAME_CLIENT_MESSAGES.CLOSE)
  close(@ConnectedSocket() client: Socket) {
    return this.guard(client, async () => {
      const { gameUuid, participantId } = this.boundState(client);
      const snapshot = await this.rooms.closeGame(gameUuid, participantId);
      this.broadcast(gameUuid, GAME_SERVER_EVENTS.SESSION_CLOSED, snapshot);
      return snapshot;
    });
  }

  /** What this socket was bound to at attach; nothing works before that. */
  private boundState(
    client: Socket,
  ): Required<Pick<GameSocketState, 'gameUuid' | 'participantId'>> {
    const { gameUuid, participantId } = this.presence.stateOf(client);
    if (!gameUuid || !participantId) {
      throw new UnauthorizedException(
        'Socket is not attached to a game; send game:attach first',
      );
    }
    return { gameUuid, participantId };
  }

  private broadcast(gameUuid: string, event: string, payload: unknown): void {
    this.presence.broadcast(gameUuid, event, payload);
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

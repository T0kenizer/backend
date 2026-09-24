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
  attachSocketDataSchema,
  declareWinnersDataSchema,
  resolveRoundDataSchema,
  spectateSocketDataSchema,
  submitActionDataSchema,
  updateSeatDataSchema,
} from '@tokenizer/shared/schemas';
import {
  GameClientMessage,
  GameMode,
  GameServerEvent,
} from '@tokenizer/shared/types';
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

  afterInit(server: Server): void {
    this.presence.bind(server);
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Socket connected: ${client.id}`);
  }

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

  @SubscribeMessage(GameClientMessage.Attach)
  attach(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(attachSocketDataSchema, payload);
      const { participantId } = this.tokens.verify(data.token, data.gameUuid);

      await this.rooms.ensureRoomOpen(data.gameUuid);
      await this.presence.attach(client, data.gameUuid, participantId);
      await this.rooms.onPlayerConnected(data.gameUuid, participantId);

      const snapshot = await this.rooms.ensureRoomOpen(data.gameUuid);
      this.broadcast(
        data.gameUuid,
        GameServerEvent.ParticipantJoined,
        snapshot,
      );
      return { snapshot, participantId };
    });
  }

  /**
   * Watch a table without being at it.
   *
   * Deliberately unauthenticated: a spectator is whoever is in the room looking
   * at the screen, and asking them for a token would mean issuing one, which
   * would mean seating them. So the only thing this proves is that the room is
   * open — {@link GameRoomsService.ensureRoomOpen} throws otherwise — and the
   * only thing it grants is the broadcast feed.
   *
   * Nothing is announced when a spectator arrives. Nobody joined; the players
   * have no reason to be told, and the seats they see must not move because a
   * television was switched on.
   */
  @SubscribeMessage(GameClientMessage.Spectate)
  spectate(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(spectateSocketDataSchema, payload);

      const snapshot = await this.rooms.ensureRoomOpen(data.gameUuid);
      await this.presence.spectate(client, data.gameUuid);

      return { snapshot };
    });
  }

  @SubscribeMessage(GameClientMessage.UpdateSeat)
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
      this.broadcast(gameUuid, GameServerEvent.ParticipantUpdated, snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage(GameClientMessage.StartHand)
  startHand(@ConnectedSocket() client: Socket) {
    return this.guard(client, async () => {
      const { gameUuid, participantId } = this.boundState(client);
      const { snapshot, resolution } = await this.rooms.startHand(
        gameUuid,
        participantId,
      );
      this.broadcast(gameUuid, GameServerEvent.HandStarted, snapshot);
      if (resolution) {
        this.broadcast(gameUuid, GameServerEvent.HandSettled, {
          ...snapshot,
          resolution,
        });
      }
      return { snapshot, resolution };
    });
  }

  @SubscribeMessage(GameClientMessage.StartRound)
  startRound(@ConnectedSocket() client: Socket) {
    return this.guard(client, async () => {
      const { gameUuid, participantId } = this.boundState(client);
      const snapshot = await this.rooms.startRound(gameUuid, participantId);
      this.broadcast(gameUuid, GameServerEvent.RoundStarted, snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage(GameClientMessage.Action)
  action(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    return this.guard(client, async () => {
      const data = parsePayload(submitActionDataSchema, payload);
      const { gameUuid, participantId } = this.boundState(client);
      const { snapshot, resolution } = await this.rooms.submitAction(
        gameUuid,
        participantId,
        data,
      );

      this.broadcast(gameUuid, GameServerEvent.ActionApplied, snapshot);
      if (resolution) {
        this.broadcast(
          gameUuid,
          resolution.mode === GameMode.Poker
            ? GameServerEvent.HandSettled
            : GameServerEvent.RoundResolved,
          { ...snapshot, resolution },
        );
      }
      return { snapshot, resolution };
    });
  }

  @SubscribeMessage(GameClientMessage.DeclareWinners)
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
      this.broadcast(gameUuid, GameServerEvent.HandSettled, {
        ...snapshot,
        resolution,
      });
      return { snapshot, resolution };
    });
  }

  @SubscribeMessage(GameClientMessage.Resolve)
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
      this.broadcast(gameUuid, GameServerEvent.RoundResolved, {
        ...snapshot,
        resolution,
      });
      return { snapshot, resolution };
    });
  }

  @SubscribeMessage(GameClientMessage.Snapshot)
  snapshot(@ConnectedSocket() client: Socket) {
    return this.guard(client, async () => {
      const { gameUuid } = this.boundState(client);
      return this.rooms.ensureRoomOpen(gameUuid);
    });
  }

  @SubscribeMessage(GameClientMessage.Close)
  close(@ConnectedSocket() client: Socket) {
    return this.guard(client, async () => {
      const { gameUuid, participantId } = this.boundState(client);
      const snapshot = await this.rooms.closeGame(gameUuid, participantId);
      this.broadcast(gameUuid, GameServerEvent.SessionClosed, snapshot);
      return snapshot;
    });
  }

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

  private broadcast(
    gameUuid: string,
    event: GameServerEvent,
    payload: unknown,
  ): void {
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
      client.emit(GameServerEvent.Error, { error: message });
      return { error: message };
    }
  }
}

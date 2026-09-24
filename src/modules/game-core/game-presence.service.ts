import { Injectable, Logger } from '@nestjs/common';
import { GameServerEvent } from '@tokenizer/shared/types';
import type { Server, Socket } from 'socket.io';

export function gameRoom(gameUuid: string): string {
  return `game:${gameUuid}`;
}

export interface GameSocketState {
  gameUuid?: string;
  /** Absent on a spectator socket: it watches the room, it does not hold a seat. */
  participantId?: string;
}

@Injectable()
export class GamePresenceService {
  private readonly logger = new Logger(GamePresenceService.name);
  private server: Nullable<Server> = null;

  public bind(server: Server): void {
    this.server = server;
  }

  public roomSize(gameUuid: string): number {
    return (
      this.server?.sockets.adapter.rooms.get(gameRoom(gameUuid))?.size ?? 0
    );
  }

  /**
   * Whether the room has lost every _player_.
   *
   * Spectators are in the same socket room — that is how they are broadcast to
   * — but they are not what keeps a table alive. Counting them here would let a
   * television left on in an empty room hold the session open forever, past
   * both the idle sweep and the release that follows the last player leaving.
   */
  public isRoomEmpty(gameUuid: string): boolean {
    return this.connectedParticipants(gameUuid).size === 0;
  }

  /** How many anonymous watchers the room is broadcasting to. */
  public spectatorCount(gameUuid: string): number {
    return this.roomSize(gameUuid) - this.connectedParticipants(gameUuid).size;
  }

  public connectedParticipants(gameUuid: string): Set<string> {
    const connected = new Set<string>();
    const room = this.server?.sockets.adapter.rooms.get(gameRoom(gameUuid));
    if (!room || !this.server) return connected;

    for (const socketId of room) {
      const socket = this.server.sockets.sockets.get(socketId);
      const participantId = (socket?.data as GameSocketState | undefined)
        ?.participantId;
      if (participantId) connected.add(participantId);
    }
    return connected;
  }

  public isParticipantConnected(
    gameUuid: string,
    participantId: string,
  ): boolean {
    return this.connectedParticipants(gameUuid).has(participantId);
  }

  public async attach(
    client: Socket,
    gameUuid: string,
    participantId: string,
  ): Promise<void> {
    const state = client.data as GameSocketState;
    state.gameUuid = gameUuid;
    state.participantId = participantId;
    await client.join(gameRoom(gameUuid));
  }

  /**
   * Binds a socket to a room without seating it.
   *
   * The state it leaves behind is deliberately half of what {@link attach}
   * writes: a `gameUuid` so broadcasts reach it, and no `participantId` at all.
   * Every message that changes the game reads its actor out of that missing
   * field, so a spectator socket is refused by the gateway without a single
   * extra check — it cannot act because there is nobody for it to act as.
   */
  public async spectate(client: Socket, gameUuid: string): Promise<void> {
    const state = client.data as GameSocketState;
    state.gameUuid = gameUuid;
    delete state.participantId;
    await client.join(gameRoom(gameUuid));
  }

  public stateOf(client: Socket): GameSocketState {
    return client.data as GameSocketState;
  }

  public broadcast(
    gameUuid: string,
    event: GameServerEvent,
    payload: unknown,
  ): void {
    this.server?.to(gameRoom(gameUuid)).emit(event, payload);
  }

  public closeRoom(gameUuid: string): void {
    this.server?.in(gameRoom(gameUuid)).disconnectSockets(true);
    this.logger.log(`Socket room for ${gameUuid} closed`);
  }
}

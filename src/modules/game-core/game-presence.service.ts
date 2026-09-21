import { Injectable, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

/** The Socket.IO room a session's sockets live in. Keyed by uuid, never by code. */
export function gameRoom(gameUuid: string): string {
  return `game:${gameUuid}`;
}

/** Per-connection state stashed on `socket.data`. */
export interface GameSocketState {
  gameUuid?: string;
  participantId?: string;
}

/**
 * Who is currently in a room.
 *
 * Presence is read straight off the Socket.IO adapter — the connections are
 * already there, and on a single instance the adapter is the only place they
 * live, so mirroring them into Redis would only create a second version of the
 * truth that can drift when a process dies mid-disconnect.
 *
 * Every read goes through {@link isRoomEmpty} / {@link roomSize} rather than
 * touching the adapter inline. That is deliberate: going multi-instance means
 * replacing the body of these two methods (with a Redis adapter and a
 * distributed presence set) and nothing else in the module.
 */
@Injectable()
export class GamePresenceService {
  private readonly logger = new Logger(GamePresenceService.name);
  private server: Nullable<Server> = null;

  /** The gateway hands over its server once it is up. */
  public bind(server: Server): void {
    this.server = server;
  }

  /** Sockets currently connected to a room. */
  public roomSize(gameUuid: string): number {
    return (
      this.server?.sockets.adapter.rooms.get(gameRoom(gameUuid))?.size ?? 0
    );
  }

  /**
   * Whether nobody is connected. The single question the lifecycle queue asks,
   * and the single place a multi-instance build would have to change.
   */
  public isRoomEmpty(gameUuid: string): boolean {
    return this.roomSize(gameUuid) === 0;
  }

  /** The seats with a live socket, deduplicated across a player's tabs. */
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

  /**
   * Whether a seat still has a socket somewhere. Called after a disconnect
   * grace period: a player who refreshed has already reconnected by then, and
   * their new socket answers for the old one.
   */
  public isParticipantConnected(
    gameUuid: string,
    participantId: string,
  ): boolean {
    return this.connectedParticipants(gameUuid).has(participantId);
  }

  /** Attaches a socket to its room and stamps the seat it speaks for. */
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

  /** What a disconnecting socket was bound to, if anything. */
  public stateOf(client: Socket): GameSocketState {
    return client.data as GameSocketState;
  }

  /** Emits an event to every socket of a room. */
  public broadcast(gameUuid: string, event: string, payload: unknown): void {
    this.server?.to(gameRoom(gameUuid)).emit(event, payload);
  }

  /** Disconnects every socket of a room, after the session has been closed. */
  public closeRoom(gameUuid: string): void {
    this.server?.in(gameRoom(gameUuid)).disconnectSockets(true);
    this.logger.log(`Socket room for ${gameUuid} closed`);
  }
}

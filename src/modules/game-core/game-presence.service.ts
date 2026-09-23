import { Injectable, Logger } from '@nestjs/common';
import { GameServerEvent } from '@tokenizer/shared/types';
import type { Server, Socket } from 'socket.io';

export function gameRoom(gameUuid: string): string {
  return `game:${gameUuid}`;
}

export interface GameSocketState {
  gameUuid?: string;
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

  public isRoomEmpty(gameUuid: string): boolean {
    return this.roomSize(gameUuid) === 0;
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

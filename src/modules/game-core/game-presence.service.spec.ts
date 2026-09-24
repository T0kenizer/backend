import {
  GamePresenceService,
  gameRoom,
} from '@modules/game-core/game-presence.service';
import type { Server, Socket } from 'socket.io';

const GAME_UUID = '11111111-1111-4111-8111-111111111111';
const SEAT_A = '22222222-2222-4222-8222-222222222222';
const SEAT_B = '33333333-3333-4333-8333-333333333333';

/** A Socket.IO adapter stand-in: rooms of socket ids, and the sockets. */
function fakeServer() {
  const rooms = new Map<string, Set<string>>();
  const sockets = new Map<string, { data: Record<string, unknown> }>();

  return {
    rooms,
    sockets: {
      adapter: { rooms },
      sockets,
    },
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    in: jest.fn().mockReturnValue({ disconnectSockets: jest.fn() }),
  };
}

function connect(
  server: ReturnType<typeof fakeServer>,
  socketId: string,
  participantId: string,
  gameUuid = GAME_UUID,
) {
  const room = gameRoom(gameUuid);
  if (!server.rooms.has(room)) server.rooms.set(room, new Set());
  server.rooms.get(room)!.add(socketId);
  server.sockets.sockets.set(socketId, { data: { gameUuid, participantId } });
}

/** The same, for a watcher: in the room, holding no seat. */
function watch(
  server: ReturnType<typeof fakeServer>,
  socketId: string,
  gameUuid = GAME_UUID,
) {
  const room = gameRoom(gameUuid);
  if (!server.rooms.has(room)) server.rooms.set(room, new Set());
  server.rooms.get(room)!.add(socketId);
  server.sockets.sockets.set(socketId, { data: { gameUuid } });
}

describe('GamePresenceService', () => {
  let service: GamePresenceService;
  let server: ReturnType<typeof fakeServer>;

  beforeEach(() => {
    service = new GamePresenceService();
    server = fakeServer();
    service.bind(server as unknown as Server);
  });

  it('reports an unknown room as empty rather than throwing', () => {
    // The lifecycle queue asks about rooms that may no longer exist at all.
    expect(service.isRoomEmpty(GAME_UUID)).toBe(true);
    expect(service.roomSize(GAME_UUID)).toBe(0);
  });

  it('reports an empty room before any server is bound', () => {
    const unbound = new GamePresenceService();

    expect(unbound.isRoomEmpty(GAME_UUID)).toBe(true);
  });

  it('counts the sockets in a room', () => {
    connect(server, 'socket-1', SEAT_A);
    connect(server, 'socket-2', SEAT_B);

    expect(service.roomSize(GAME_UUID)).toBe(2);
    expect(service.isRoomEmpty(GAME_UUID)).toBe(false);
  });

  it('calls a room the players have left empty, spectators or not', () => {
    // A television left on in an empty room must not hold the session open:
    // the idle sweep and the room release both ask this question.
    watch(server, 'socket-tv');

    expect(service.roomSize(GAME_UUID)).toBe(1);
    expect(service.isRoomEmpty(GAME_UUID)).toBe(true);
    expect(service.spectatorCount(GAME_UUID)).toBe(1);
  });

  it('leaves the seated count alone when watchers join', () => {
    connect(server, 'socket-1', SEAT_A);
    watch(server, 'socket-tv');

    expect([...service.connectedParticipants(GAME_UUID)]).toEqual([SEAT_A]);
    expect(service.isRoomEmpty(GAME_UUID)).toBe(false);
    expect(service.spectatorCount(GAME_UUID)).toBe(1);
  });

  it('deduplicates a player holding one seat across several tabs', () => {
    connect(server, 'socket-1', SEAT_A);
    connect(server, 'socket-2', SEAT_A);

    expect(service.roomSize(GAME_UUID)).toBe(2);
    expect([...service.connectedParticipants(GAME_UUID)]).toEqual([SEAT_A]);
  });

  it('still sees a seat as connected while another of its tabs is open', () => {
    connect(server, 'socket-1', SEAT_A);
    connect(server, 'socket-2', SEAT_A);
    // One tab closes; the seat is not gone.
    server.rooms.get(gameRoom(GAME_UUID))!.delete('socket-1');

    expect(service.isParticipantConnected(GAME_UUID, SEAT_A)).toBe(true);
  });

  it('does not count a seat whose sockets have all gone', () => {
    connect(server, 'socket-1', SEAT_A);
    connect(server, 'socket-2', SEAT_B);
    server.rooms.get(gameRoom(GAME_UUID))!.delete('socket-1');

    expect(service.isParticipantConnected(GAME_UUID, SEAT_A)).toBe(false);
    expect(service.isParticipantConnected(GAME_UUID, SEAT_B)).toBe(true);
  });

  it('keeps rooms of different games apart', () => {
    const other = '44444444-4444-4444-8444-444444444444';
    connect(server, 'socket-1', SEAT_A);
    connect(server, 'socket-2', SEAT_B, other);

    expect(service.roomSize(GAME_UUID)).toBe(1);
    expect(service.roomSize(other)).toBe(1);
  });

  it('keys rooms by uuid, never by a join code', () => {
    // The code is a lookup key for humans; using it as a room name would tie
    // the room's lifetime to a TTL that has nothing to do with the game.
    expect(gameRoom(GAME_UUID)).toBe(`game:${GAME_UUID}`);
  });

  it('stamps the seat a socket speaks for when attaching', async () => {
    const client = { data: {}, join: jest.fn() } as unknown as Socket;

    await service.attach(client, GAME_UUID, SEAT_A);

    expect(client.join).toHaveBeenCalledWith(gameRoom(GAME_UUID));
    expect(service.stateOf(client)).toEqual({
      gameUuid: GAME_UUID,
      participantId: SEAT_A,
    });
  });

  it('binds a spectator to the room without a seat to act as', async () => {
    const client = { data: {}, join: jest.fn() } as unknown as Socket;

    await service.spectate(client, GAME_UUID);

    expect(client.join).toHaveBeenCalledWith(gameRoom(GAME_UUID));
    expect(service.stateOf(client)).toEqual({ gameUuid: GAME_UUID });
  });

  it('strips the seat from a socket that stops playing and starts watching', async () => {
    const client = { data: {}, join: jest.fn() } as unknown as Socket;

    await service.attach(client, GAME_UUID, SEAT_A);
    await service.spectate(client, GAME_UUID);

    // Left behind, `participantId` would let the gateway act as that seat on
    // behalf of a socket that has given it up.
    expect(service.stateOf(client).participantId).toBeUndefined();
  });
});

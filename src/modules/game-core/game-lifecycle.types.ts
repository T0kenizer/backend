import type { Job, Queue } from 'bullmq';

export enum GameLifecycleJob {
  /** A room went empty; close the session unless somebody came back. */
  CloseEmptyRoom = 'close-empty-room',
  /** A table was ended; drop its room once everyone has read the recap. */
  TeardownClosedRoom = 'teardown-closed-room',
  /** A socket dropped; decide whether its seat holder is really gone. */
  PlayerDisconnected = 'player-disconnected',
  /** Periodic safety net for lifecycle jobs lost to a restart. */
  SweepStaleSessions = 'sweep-stale-sessions',
}

export interface CloseEmptyRoomJobData {
  gameUuid: string;
}

export interface TeardownClosedRoomJobData {
  gameUuid: string;
}

export interface PlayerDisconnectedJobData {
  gameUuid: string;
  participantId: string;
}

export type SweepStaleSessionsJobData = Record<string, never>;

export type GameLifecycleJobData = {
  [GameLifecycleJob.CloseEmptyRoom]: CloseEmptyRoomJobData;
  [GameLifecycleJob.TeardownClosedRoom]: TeardownClosedRoomJobData;
  [GameLifecycleJob.PlayerDisconnected]: PlayerDisconnectedJobData;
  [GameLifecycleJob.SweepStaleSessions]: SweepStaleSessionsJobData;
};

export type GameLifecycleQueueJob = {
  [Name in GameLifecycleJob]: Job<GameLifecycleJobData[Name], void, Name>;
}[GameLifecycleJob];

export type GameLifecycleQueue = Queue<
  GameLifecycleJobData[GameLifecycleJob],
  void,
  GameLifecycleJob
>;

/**
 * Job ids are derived, never random, so a job can be cancelled by name alone
 * and a second scheduling replaces the first instead of stacking onto it.
 *
 * Separated by `--`, never by a colon: BullMQ refuses a custom id containing
 * one ("Custom Id cannot contain :") because that is its own Redis key
 * separator. A colon here does not fail loudly — `queue.add` throws inside
 * whatever was scheduling it, and the deferred decision is simply never armed —
 * so the separator is asserted in the spec beside these.
 */
const SEPARATOR = '--';

export function closeEmptyRoomJobId(gameUuid: string): string {
  return `close-empty-room${SEPARATOR}${gameUuid}`;
}

export function teardownClosedRoomJobId(gameUuid: string): string {
  return `teardown-closed-room${SEPARATOR}${gameUuid}`;
}

export function playerDisconnectedJobId(
  gameUuid: string,
  participantId: string,
): string {
  return `player-disconnected${SEPARATOR}${gameUuid}${SEPARATOR}${participantId}`;
}

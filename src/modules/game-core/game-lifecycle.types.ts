import type { Job, Queue } from 'bullmq';

export enum GameLifecycleJob {
  ReleaseEmptyRoom = 'release-empty-room',
  TeardownClosedRoom = 'teardown-closed-room',
  PlayerDisconnected = 'player-disconnected',
  SweepStaleSessions = 'sweep-stale-sessions',
}

export interface ReleaseEmptyRoomJobData {
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
  [GameLifecycleJob.ReleaseEmptyRoom]: ReleaseEmptyRoomJobData;
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

const SEPARATOR = '--';

export function releaseEmptyRoomJobId(gameUuid: string): string {
  return `release-empty-room${SEPARATOR}${gameUuid}`;
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

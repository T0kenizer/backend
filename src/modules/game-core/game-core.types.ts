export type ConfigJSON = object;

export type GameSessionId = string;
export type ParticipantId = string;
export type RoundId = string;
export type PotId = string;
export type ActionId = string;
export type ControllerIdentifier = string;

/**
 * Internal runtime join params. Unlike the shared `JoinGameSessionData` (whose
 * `initialBalance` is optional and defaulted by validation), the runtime always
 * receives a resolved balance.
 */
export interface JoinParams {
  /** External identity: authenticated user UUID or an anonymous client id. */
  externalId: string;
  displayName: string;
  initialBalance: number;
}

/** Redis payload mapping a connected socket to its game session. */
export interface SocketBinding {
  gameId: GameSessionId;
  externalId: string;
}

/** An open room with no connected socket is closed after this long. */
export const ROOM_IDLE_TTL_MS = 5 * 60 * 1000;

/** Safety TTL on registry keys so a crashed process cannot leak them forever. */
export const REGISTRY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Pre-validates uuids reaching the runtime over WebSocket, where no
 * `ParseUUIDPipe` applies, so a malformed id fails cleanly instead of blowing
 * up in the Postgres uuid cast.
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

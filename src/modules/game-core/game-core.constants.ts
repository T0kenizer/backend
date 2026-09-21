/**
 * Join codes are 6 digits so they can be read aloud without spelling: a code is
 * a lookup key, never an identifier. It lives in Redis only, under a sliding
 * TTL, and resolves to the session uuid everything else is keyed by.
 */
export const JOIN_CODE_LENGTH = 6;

/**
 * How long a code survives without activity. Every join and every gameplay
 * transition pushes it back, so a live room keeps its code and an abandoned one
 * lets it lapse on its own — which is why nothing ever has to delete it.
 */
export const JOIN_CODE_TTL_SECONDS = 30 * 60;

/** Collisions are resolved by re-drawing; `SET NX` makes the draw atomic. */
export const JOIN_CODE_MAX_ATTEMPTS = 10;

/**
 * The join QR encodes a link keyed by the session uuid, so its bytes never
 * change for a given room — it is rendered on demand and cached like a file's
 * content rather than stored anywhere.
 *
 * `M` corrects a quarter of the symbol, which is what a code read off a TV
 * across a room at an angle needs; `H` would buy resilience nobody is short of
 * at the cost of a denser symbol. Four modules of quiet zone is the spec
 * minimum — below it, scanners lose the finder patterns against the screen.
 */
export const JOIN_QR_ERROR_CORRECTION = 'M';
export const JOIN_QR_WIDTH_PX = 512;
export const JOIN_QR_MARGIN_MODULES = 4;

/** A year, like the files module: the payload behind a uuid is immutable. */
export const JOIN_QR_MAX_AGE_SECONDS = 31_536_000;

/**
 * Grace period for a single player. A page refresh drops the socket and opens a
 * new one within a second or two; anything under this window must not read as
 * the player leaving.
 */
export const PLAYER_DISCONNECT_GRACE_MS = 15 * 1000;

/**
 * Grace period for the room itself: how long an empty room is held open before
 * the session is marked abandoned. Long enough for a whole table to survive a
 * backend restart or a shared network blip.
 */
export const ROOM_EMPTY_GRACE_MS = 5 * 60 * 1000;

/** BullMQ queue carrying every deferred lifecycle decision. */
export const GAME_LIFECYCLE_QUEUE = 'game-lifecycle';

export const WORKER_CONCURRENCY = 5;

/**
 * Safety net for lifecycle jobs lost to an ill-timed restart: sweep on this
 * cadence and close anything that has been silent for
 * {@link STALE_SESSION_THRESHOLD_MS}.
 */
export const STALE_SWEEP_CRON = '*/10 * * * *';
export const STALE_SESSION_THRESHOLD_MS = 60 * 60 * 1000;

/** How many sessions a single sweep closes, so one pass cannot run away. */
export const STALE_SWEEP_BATCH_SIZE = 200;

/** Player tokens outlive a long session but not an abandoned browser tab. */
export const PLAYER_TOKEN_TTL = '12h';

/**
 * Rate limits for the two endpoints a code can reach. They are deliberately
 * tighter than the global default: a 6-digit code is only 10^6 wide, so an
 * unthrottled lookup is an enumeration oracle.
 */
export const JOIN_BY_CODE_LIMIT = 10;
export const JOIN_BY_CODE_TTL_MS = 60 * 1000;
export const ROOM_BY_CODE_LIMIT = 20;
export const ROOM_BY_CODE_TTL_MS = 60 * 1000;

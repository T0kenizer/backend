export const JOIN_CODE_TTL_SECONDS = 30 * 60;

export const JOIN_CODE_MAX_ATTEMPTS = 10;

export const JOIN_QR_ERROR_CORRECTION = 'M';
export const JOIN_QR_WIDTH_PX = 512;
export const JOIN_QR_MARGIN_MODULES = 4;

export const JOIN_QR_MAX_AGE_SECONDS = 31_536_000;

export const PLAYER_DISCONNECT_GRACE_MS = 15 * 1000;

export const ROOM_EMPTY_GRACE_MS = 5 * 60 * 1000;

export const CLOSED_ROOM_GRACE_MS = 2 * 60 * 1000;

/** BullMQ queue carrying every deferred lifecycle decision. */
export const GAME_LIFECYCLE_QUEUE = 'game-lifecycle';

export const WORKER_CONCURRENCY = 5;

export const STALE_SWEEP_CRON = '*/10 * * * *';
export const STALE_SESSION_THRESHOLD_MS = 60 * 60 * 1000;

export const PLAYER_TOKEN_TTL = '12h';

export const JOIN_BY_CODE_LIMIT = 10;
export const JOIN_BY_CODE_TTL_MS = 60 * 1000;
export const ROOM_BY_CODE_LIMIT = 20;
export const ROOM_BY_CODE_TTL_MS = 60 * 1000;

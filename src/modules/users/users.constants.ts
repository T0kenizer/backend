export const BANNED_USERNAMES = ['me'];

/**
 * How long a signed avatar URL is reused before it is signed again. Far below
 * the URL's own expiry: this exists to keep the string stable across the many
 * snapshots a game room broadcasts, not to stretch the signature's life.
 */
export const AVATAR_URL_CACHE_TTL_MS = 60 * 60 * 1000;

/** Most avatars kept memoised at once; the oldest entry is dropped past it. */
export const AVATAR_URL_CACHE_SIZE = 500;

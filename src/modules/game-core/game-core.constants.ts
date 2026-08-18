/** An open room with no connected socket is closed after this long. */
export const ROOM_IDLE_TTL_MS = 5 * 60 * 1000;

/** Safety TTL on registry keys so a crashed process cannot leak them forever. */
export const REGISTRY_TTL_SECONDS = 24 * 60 * 60;

/** Join code length and alphabet (unambiguous: no 0/O/1/I). */
export const JOIN_CODE_LENGTH = 6;
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** How many collisions to retry before giving up on generating a join code. */
export const JOIN_CODE_MAX_ATTEMPTS = 10;

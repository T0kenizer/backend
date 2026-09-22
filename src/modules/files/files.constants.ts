export const FILES_QUEUE = 'files';

// Content is immutable per uuid, so signed URLs use the longest expiry GCS
// V4 signing allows rather than a short-lived one that needs refreshing.
export const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const FILES_QUEUE = 'files';

// Content is immutable per uuid, so signed URLs use the longest expiry GCS
// V4 signing allows rather than a short-lived one that needs refreshing.
export const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Every upload is stored as webp: one format to serve, and smaller objects
// than the png/jpeg originals at an equivalent visual quality.
export const STORED_MIME_TYPE = 'image/webp';

// sharp's own default. Low enough to be worth the conversion, high enough to
// leave no visible artefact on the avatars this serves.
export const WEBP_QUALITY = 80;

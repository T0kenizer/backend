export const AUTH_COOKIE_NAME = 'GATEAU_SEC';

export const SESSION_TIMEOUT_MS = 1000 * 60 * 60 * 24; // 1 day
export const EXTENDED_SESSION_TIMEOUT_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export const OAUTH_CALLBACK_PATH = '/callback/google';

export type OAuthErrorCode = 'access_denied' | 'unverified_email' | 'failed';

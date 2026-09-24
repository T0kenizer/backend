import * as Types from '@modules/mail/mail.types';

export const MAIL_QUEUE = 'mail';

export const WORKER_CONCURRENCY = 5;
export const SMTP_MAX_CONNECTIONS = 5;
export const SMTP_MAX_MESSAGES = 100;

export const DEFAULT_SENDER: Types.Sender = Types.Sender.Noreply;

export const LOGO_PATH = '/logo/tokenizer-logo.png';

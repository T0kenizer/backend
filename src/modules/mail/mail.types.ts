import {
  MAIL_JOB_ACCOUNT_CONFIRMATION,
  MAIL_JOB_ACCOUNT_CONFIRMED,
  MAIL_JOB_ACCOUNT_DELETED,
  MAIL_JOB_ACCOUNT_DELETION,
  MAIL_JOB_EMAIL_CHANGED,
  MAIL_JOB_PASSWORD_CHANGED,
  MAIL_JOB_PASSWORD_RESET,
} from '@modules/mail/mail.constants';

export interface PasswordResetJobData {
  email: string;
  resetUrl: string;
}

export interface AccountDeletionJobData {
  email: string;
  deletionUrl: string;
}

export interface PasswordChangedJobData {
  email: string;
}

export interface AccountDeletedJobData {
  email: string;
}

export interface AccountConfirmationJobData {
  email: string;
  confirmationUrl: string;
}

export interface AccountConfirmedJobData {
  email: string;
}

export interface EmailChangedJobData {
  /** The address the notice goes to, i.e. the one being replaced. */
  email: string;
  newEmail: string;
}

export interface MailJobDataMap {
  [MAIL_JOB_PASSWORD_RESET]: PasswordResetJobData;
  [MAIL_JOB_ACCOUNT_DELETION]: AccountDeletionJobData;
  [MAIL_JOB_PASSWORD_CHANGED]: PasswordChangedJobData;
  [MAIL_JOB_ACCOUNT_DELETED]: AccountDeletedJobData;
  [MAIL_JOB_ACCOUNT_CONFIRMATION]: AccountConfirmationJobData;
  [MAIL_JOB_ACCOUNT_CONFIRMED]: AccountConfirmedJobData;
  [MAIL_JOB_EMAIL_CHANGED]: EmailChangedJobData;
}

export type MailJobName = keyof MailJobDataMap;

export type MailJobData = {
  [Name in MailJobName]: MailJobDataMap[Name];
}[MailJobName];

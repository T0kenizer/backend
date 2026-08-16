import { Job, Queue } from 'bullmq';

export enum MailJob {
  AccountConfirmation = 'account-confirmation',
  AccountConfirmed = 'account-confirmed',
  AccountDeleted = 'account-deleted',
  AccountDeletion = 'account-deletion',
  EmailChanged = 'email-changed',
  PasswordChanged = 'password-changed',
  PasswordReset = 'password-reset',
}

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
  email: string;
  newEmail: string;
}

export type MailJobData = {
  [MailJob.AccountConfirmation]: AccountConfirmationJobData;
  [MailJob.AccountConfirmed]: AccountConfirmedJobData;
  [MailJob.AccountDeleted]: AccountDeletedJobData;
  [MailJob.AccountDeletion]: AccountDeletionJobData;
  [MailJob.EmailChanged]: EmailChangedJobData;
  [MailJob.PasswordChanged]: PasswordChangedJobData;
  [MailJob.PasswordReset]: PasswordResetJobData;
};

export type MailQueueJob = {
  [Name in MailJob]: Job<MailJobData[Name], void, Name>;
}[MailJob];

export type MailQueue = Queue<MailJobData[MailJob], void, MailJob>;

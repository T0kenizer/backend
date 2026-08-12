import { MAIL_JOB_PASSWORD_RESET } from '@modules/mail/mail.constants';

export interface PasswordResetJobData {
  email: string;
  resetUrl: string;
}

export interface MailJobDataMap {
  [MAIL_JOB_PASSWORD_RESET]: PasswordResetJobData;
}

export type MailJobName = keyof MailJobDataMap;

export type MailJobData = MailJobDataMap[MailJobName];

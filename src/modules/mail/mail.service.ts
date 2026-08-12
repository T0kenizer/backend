import * as Constants from '@modules/mail/mail.constants';
import * as Types from '@modules/mail/mail.types';
import { MailerService } from '@nestjs-modules/mailer';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class MailService {
  constructor(
    private readonly mailerService: MailerService,
    @InjectQueue(Constants.MAIL_QUEUE)
    private readonly queue: Queue<Types.MailJobData>,
  ) {}

  public async sendPasswordReset(
    email: string,
    resetUrl: string,
  ): Promise<void> {
    await this.queue.add(
      Constants.MAIL_JOB_PASSWORD_RESET,
      { email, resetUrl },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  public async sendAccountDeletion(
    email: string,
    deletionUrl: string,
  ): Promise<void> {
    await this.queue.add(
      Constants.MAIL_JOB_ACCOUNT_DELETION,
      { email, deletionUrl },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  public deliverAccountDeletion(email: string, deletionUrl: string) {
    return this.mailerService.sendMail({
      to: email,
      subject: 'Confirm your account deletion',
      template: 'delete-account',
      context: {
        deletionUrl,
        title: 'Confirm your account deletion',
        year: new Date().getFullYear(),
      },
    });
  }

  public deliverPasswordReset(email: string, resetUrl: string) {
    return this.mailerService.sendMail({
      to: email,
      subject: 'Reset your password',
      template: 'reset-password',
      context: {
        resetUrl,
        title: 'Reset your password',
        year: new Date().getFullYear(),
      },
    });
  }

  public async sendAccountConfirmation(
    email: string,
    confirmationUrl: string,
  ): Promise<void> {
    await this.queue.add(
      Constants.MAIL_JOB_ACCOUNT_CONFIRMATION,
      { email, confirmationUrl } satisfies Types.AccountConfirmationJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  public deliverAccountConfirmation(email: string, confirmationUrl: string) {
    return this.mailerService.sendMail({
      to: email,
      subject: 'Confirm your email address',
      template: 'confirm-account',
      context: {
        confirmationUrl,
        title: 'Confirm your email address',
        year: new Date().getFullYear(),
      },
    });
  }

  public async sendAccountConfirmed(email: string): Promise<void> {
    await this.queue.add(
      Constants.MAIL_JOB_ACCOUNT_CONFIRMED,
      { email } satisfies Types.AccountConfirmedJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  public deliverAccountConfirmed(email: string) {
    return this.mailerService.sendMail({
      to: email,
      subject: 'Your email address is confirmed',
      template: 'account-confirmed',
      context: {
        title: 'Your email address is confirmed',
        year: new Date().getFullYear(),
      },
    });
  }

  public async sendPasswordChanged(email: string): Promise<void> {
    await this.queue.add(
      Constants.MAIL_JOB_PASSWORD_CHANGED,
      { email } satisfies Types.PasswordChangedJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  public deliverPasswordChanged(email: string) {
    return this.mailerService.sendMail({
      to: email,
      subject: 'Your password has been changed',
      template: 'password-changed',
      context: {
        title: 'Your password has been changed',
        year: new Date().getFullYear(),
      },
    });
  }

  public async sendEmailChanged(
    email: string,
    newEmail: string,
  ): Promise<void> {
    await this.queue.add(
      Constants.MAIL_JOB_EMAIL_CHANGED,
      { email, newEmail } satisfies Types.EmailChangedJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  public deliverEmailChanged(email: string, newEmail: string) {
    return this.mailerService.sendMail({
      to: email,
      subject: 'Your email address has been changed',
      template: 'email-changed',
      context: {
        newEmail,
        title: 'Your email address has been changed',
        year: new Date().getFullYear(),
      },
    });
  }

  public async sendAccountDeleted(email: string): Promise<void> {
    await this.queue.add(
      Constants.MAIL_JOB_ACCOUNT_DELETED,
      { email } satisfies Types.AccountDeletedJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  public deliverAccountDeleted(email: string) {
    return this.mailerService.sendMail({
      to: email,
      subject: 'Your account has been deleted',
      template: 'account-deleted',
      context: {
        title: 'Your account has been deleted',
        year: new Date().getFullYear(),
      },
    });
  }
}

import { ConfigService } from '@modules/config/config.service';
import * as Constants from '@modules/mail/mail.constants';
import * as Types from '@modules/mail/mail.types';
import { isMailConfigured } from '@modules/mail/mail.utils';
import { MailerService } from '@nestjs-modules/mailer';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsOptions } from 'bullmq';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    @InjectQueue(Constants.MAIL_QUEUE)
    private readonly queue: Types.MailQueue,
  ) {}

  onModuleInit(): void {
    if (isMailConfigured(this.configService)) return;

    this.logger.warn(
      'Mailing is disabled: SMTP_HOST and SMTP_FROM_DOMAIN are not set, so no account mail will be delivered',
    );
  }

  private async enqueue<Name extends Types.MailJob>(
    name: Name,
    data: Types.MailJobData[Name],
    opts?: JobsOptions,
  ): Promise<void> {
    if (!isMailConfigured(this.configService)) return;

    await this.queue.add(name, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      ...opts,
    });
  }

  public async sendPasswordReset(
    email: string,
    resetUrl: string,
  ): Promise<void> {
    await this.enqueue(Types.MailJob.PasswordReset, { email, resetUrl });
  }

  public async sendAccountDeletion(
    email: string,
    deletionUrl: string,
  ): Promise<void> {
    await this.enqueue(Types.MailJob.AccountDeletion, { email, deletionUrl });
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
    await this.enqueue(Types.MailJob.AccountConfirmation, {
      email,
      confirmationUrl,
    });
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
    await this.enqueue(Types.MailJob.AccountConfirmed, { email });
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
    await this.enqueue(Types.MailJob.PasswordChanged, { email });
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
    await this.enqueue(Types.MailJob.EmailChanged, { email, newEmail });
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
    await this.enqueue(Types.MailJob.AccountDeleted, { email });
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

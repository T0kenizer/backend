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
}

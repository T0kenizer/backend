import { TOKEN_TTL_MS as ACCOUNT_CONFIRMATION_TOKEN_TTL_MS } from '@modules/account-confirmations/account-confirmations.constants';
import { TOKEN_TTL_MS as ACCOUNT_DELETION_TOKEN_TTL_MS } from '@modules/account-deletions/account-deletions.constants';
import * as Constants from '@modules/mail/mail.constants';
import { MailService } from '@modules/mail/mail.service';
import * as Types from '@modules/mail/mail.types';
import { TOKEN_TTL_MS as PASSWORD_RESET_TOKEN_TTL_MS } from '@modules/password-resets/password-resets.constants';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

@Processor(Constants.MAIL_QUEUE, {
  concurrency: Constants.WORKER_CONCURRENCY,
})
export class MailConsumer extends WorkerHost {
  private readonly logger = new Logger(MailConsumer.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  public async process(job: Types.MailQueueJob): Promise<void> {
    switch (job.name) {
      case Types.MailJob.PasswordReset: {
        if (Date.now() > job.timestamp + PASSWORD_RESET_TOKEN_TTL_MS) {
          this.logger.warn(
            `Mail job "${job.name}" (${job.id}) outlived the reset token, skipping`,
          );
          break;
        }

        const { email, resetUrl } = job.data;
        await this.mailService.deliverPasswordReset(email, resetUrl);
        break;
      }
      case Types.MailJob.AccountDeletion: {
        if (Date.now() > job.timestamp + ACCOUNT_DELETION_TOKEN_TTL_MS) {
          this.logger.warn(
            `Mail job "${job.name}" (${job.id}) outlived the deletion token, skipping`,
          );
          break;
        }

        const { email, deletionUrl } = job.data;
        await this.mailService.deliverAccountDeletion(email, deletionUrl);
        break;
      }
      case Types.MailJob.AccountConfirmation: {
        if (Date.now() > job.timestamp + ACCOUNT_CONFIRMATION_TOKEN_TTL_MS) {
          this.logger.warn(
            `Mail job "${job.name}" (${job.id}) outlived the confirmation token, skipping`,
          );
          break;
        }

        const { email, confirmationUrl } = job.data;
        await this.mailService.deliverAccountConfirmation(
          email,
          confirmationUrl,
        );
        break;
      }
      // Security notices carry no token, so there is nothing to outlive.
      case Types.MailJob.AccountConfirmed: {
        const { email } = job.data;
        await this.mailService.deliverAccountConfirmed(email);
        break;
      }
      case Types.MailJob.PasswordChanged: {
        const { email } = job.data;
        await this.mailService.deliverPasswordChanged(email);
        break;
      }
      case Types.MailJob.AccountDeleted: {
        const { email } = job.data;
        await this.mailService.deliverAccountDeleted(email);
        break;
      }
      case Types.MailJob.EmailChanged: {
        const { email, newEmail } = job.data;
        await this.mailService.deliverEmailChanged(email, newEmail);
        break;
      }
      default:
        throw new Error(
          `Unknown mail job "${(job satisfies never as Types.MailQueueJob).name}"`,
        );
    }
  }

  @OnWorkerEvent('failed')
  public onFailed(job: Optional<Types.MailQueueJob>, error: Error): void {
    // BullMQ retries the job, so this fires on every attempt, not just the last.
    this.logger.error(
      `Mail job "${job?.name}" (${job?.id}) failed on attempt ${job?.attemptsMade}`,
      error.stack,
    );
  }
}

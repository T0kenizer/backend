import { TOKEN_TTL_MS as ACCOUNT_CONFIRMATION_TOKEN_TTL_MS } from '@modules/account-confirmations/account-confirmations.constants';
import { TOKEN_TTL_MS as ACCOUNT_DELETION_TOKEN_TTL_MS } from '@modules/account-deletions/account-deletions.constants';
import * as Constants from '@modules/mail/mail.constants';
import { MailService } from '@modules/mail/mail.service';
import * as Types from '@modules/mail/mail.types';
import { TOKEN_TTL_MS as PASSWORD_RESET_TOKEN_TTL_MS } from '@modules/password-resets/password-resets.constants';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor(Constants.MAIL_QUEUE)
export class MailConsumer extends WorkerHost {
  private readonly logger = new Logger(MailConsumer.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  public async process(job: Job<Types.MailJobData>): Promise<void> {
    switch (job.name) {
      case Constants.MAIL_JOB_PASSWORD_RESET: {
        if (Date.now() > job.timestamp + PASSWORD_RESET_TOKEN_TTL_MS) {
          this.logger.warn(
            `Mail job "${job.name}" (${job.id}) outlived the reset token, skipping`,
          );
          break;
        }

        const { email, resetUrl } = job.data as Types.PasswordResetJobData;
        await this.mailService.deliverPasswordReset(email, resetUrl);
        break;
      }
      case Constants.MAIL_JOB_ACCOUNT_DELETION: {
        if (Date.now() > job.timestamp + ACCOUNT_DELETION_TOKEN_TTL_MS) {
          this.logger.warn(
            `Mail job "${job.name}" (${job.id}) outlived the deletion token, skipping`,
          );
          break;
        }

        const { email, deletionUrl } = job.data as Types.AccountDeletionJobData;
        await this.mailService.deliverAccountDeletion(email, deletionUrl);
        break;
      }
      case Constants.MAIL_JOB_ACCOUNT_CONFIRMATION: {
        if (Date.now() > job.timestamp + ACCOUNT_CONFIRMATION_TOKEN_TTL_MS) {
          this.logger.warn(
            `Mail job "${job.name}" (${job.id}) outlived the confirmation token, skipping`,
          );
          break;
        }

        const { email, confirmationUrl } =
          job.data as Types.AccountConfirmationJobData;
        await this.mailService.deliverAccountConfirmation(
          email,
          confirmationUrl,
        );
        break;
      }
      // Security notices carry no token, so there is nothing to outlive.
      case Constants.MAIL_JOB_ACCOUNT_CONFIRMED: {
        const { email } = job.data;
        await this.mailService.deliverAccountConfirmed(email);
        break;
      }
      case Constants.MAIL_JOB_PASSWORD_CHANGED: {
        const { email } = job.data;
        await this.mailService.deliverPasswordChanged(email);
        break;
      }
      case Constants.MAIL_JOB_ACCOUNT_DELETED: {
        const { email } = job.data;
        await this.mailService.deliverAccountDeleted(email);
        break;
      }
      case Constants.MAIL_JOB_EMAIL_CHANGED: {
        const { email, newEmail } = job.data as Types.EmailChangedJobData;
        await this.mailService.deliverEmailChanged(email, newEmail);
        break;
      }
      default:
        throw new Error(`Unknown mail job "${job.name}"`);
    }
  }

  @OnWorkerEvent('failed')
  public onFailed(job: Job<Types.MailJobData> | undefined, error: Error): void {
    // BullMQ retries the job, so this fires on every attempt, not just the last.
    this.logger.error(
      `Mail job "${job?.name}" (${job?.id}) failed on attempt ${job?.attemptsMade}`,
      error.stack,
    );
  }
}

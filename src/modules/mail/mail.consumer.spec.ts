import { MailConsumer } from '@modules/mail/mail.consumer';
import { MailService } from '@modules/mail/mail.service';
import * as Types from '@modules/mail/mail.types';
import { TOKEN_TTL_MS as PASSWORD_RESET_TOKEN_TTL_MS } from '@modules/password-resets/password-resets.constants';

jest.mock('@nestjs/bullmq', () => ({
  WorkerHost: class {},
  Processor: () => () => undefined,
  OnWorkerEvent: () => () => undefined,
  InjectQueue: () => () => undefined,
}));

describe(MailConsumer.name, () => {
  let consumer: MailConsumer;
  let mailService: { deliverPasswordReset: jest.Mock };

  const job = <Name extends Types.MailJob>(
    name: Name,
    data: Types.MailJobData[Name],
    timestamp = Date.now(),
  ) => ({ name, id: '42', timestamp, data }) as Types.MailQueueJob;

  beforeEach(() => {
    mailService = {
      deliverPasswordReset: jest.fn().mockResolvedValue(undefined),
    };
    consumer = new MailConsumer(mailService as unknown as MailService);
  });

  describe('token mails', () => {
    const data = { email: 'user@tokenizer.fr', resetUrl: 'https://reset' };

    it('should deliver a fresh password reset', async () => {
      await consumer.process(job(Types.MailJob.PasswordReset, data));

      expect(mailService.deliverPasswordReset).toHaveBeenCalledWith(
        data.email,
        data.resetUrl,
      );
    });

    it('should skip one whose token has already expired', async () => {
      await consumer.process(
        job(
          Types.MailJob.PasswordReset,
          data,
          Date.now() - PASSWORD_RESET_TOKEN_TTL_MS - 1,
        ),
      );

      expect(mailService.deliverPasswordReset).not.toHaveBeenCalled();
    });
  });

  it('should throw on an unknown job name', async () => {
    const unknown = { name: 'nope', data: {} } as unknown as Types.MailQueueJob;

    await expect(consumer.process(unknown)).rejects.toThrow('Unknown mail job');
  });
});

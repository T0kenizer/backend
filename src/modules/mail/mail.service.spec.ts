import { ConfigService } from '@modules/config/config.service';
import { MailService } from '@modules/mail/mail.service';
import * as Types from '@modules/mail/mail.types';
import { MailerService } from '@nestjs-modules/mailer';
import { Logger } from '@nestjs/common';

describe(MailService.name, () => {
  let service: MailService;
  let mailerService: { sendMail: jest.Mock };
  let queue: { add: jest.Mock };

  const build = (overrides: Record<string, unknown> = {}) => {
    const config: Record<string, unknown> = {
      NODE_ENV: 'production',
      SMTP_HOST: 'mailpit',
      SMTP_FROM_DOMAIN: 'tokenizer.fr',
      ...overrides,
    };

    return new MailService(
      mailerService as unknown as MailerService,
      { get: (key: string) => config[key] } as unknown as ConfigService,
      queue as unknown as Types.MailQueue,
    );
  };

  beforeEach(() => {
    mailerService = { sendMail: jest.fn().mockResolvedValue(undefined) };
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    service = build();
  });

  describe('send*', () => {
    it('should enqueue instead of talking to SMTP', async () => {
      await service.sendPasswordReset('user@example.com', 'https://reset');

      expect(queue.add).toHaveBeenCalledWith(
        Types.MailJob.PasswordReset,
        { email: 'user@example.com', resetUrl: 'https://reset' },
        expect.objectContaining({ attempts: 3 }),
      );
      expect(mailerService.sendMail).not.toHaveBeenCalled();
    });

    it.each([
      ['SMTP_HOST', { SMTP_HOST: undefined }],
      ['SMTP_FROM_DOMAIN', { SMTP_FROM_DOMAIN: undefined }],
      ['SMTP_HOST (empty)', { SMTP_HOST: '' }],
    ])(
      'should do nothing when %s is missing rather than throw',
      async (_, overrides) => {
        await expect(
          build(overrides).sendPasswordReset('user@example.com', 'https://x'),
        ).resolves.toBeUndefined();

        expect(queue.add).not.toHaveBeenCalled();
      },
    );

    it('should enqueue outside production too', async () => {
      await build({ NODE_ENV: 'development' }).sendAccountConfirmed(
        'user@example.com',
      );

      expect(queue.add).toHaveBeenCalled();
    });
  });

  describe('deliver*', () => {
    it('should render the template with the job context', async () => {
      await service.deliverPasswordReset('user@example.com', 'https://reset');

      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          template: 'reset-password',
          context: expect.objectContaining({
            resetUrl: 'https://reset',
          }) as unknown,
        }),
      );
    });

    it('should leave the sender to the transport default', async () => {
      await service.deliverAccountConfirmed('user@example.com');

      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.not.objectContaining({ from: expect.anything() as unknown }),
      );
    });
  });

  describe('onModuleInit', () => {
    it('should warn that account mails will not be delivered', () => {
      build({ SMTP_HOST: undefined }).onModuleInit();

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('Mailing is disabled'),
      );
    });

    it('should stay quiet when mailing is configured', () => {
      service.onModuleInit();

      expect(Logger.prototype.warn).not.toHaveBeenCalled();
    });
  });
});

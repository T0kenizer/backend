import { ConfigService } from '@modules/config/config.service';
import { DEFAULT_SENDER } from '@modules/mail/mail.constants';
import { Sender } from '@modules/mail/mail.types';
import { isMailConfigured, sender } from '@modules/mail/mail.utils';

const configService = (overrides: Record<string, unknown> = {}) => {
  const config: Record<string, unknown> = {
    SMTP_HOST: 'mailpit',
    SMTP_FROM_DOMAIN: 'tokenizer.fr',
    ...overrides,
  };

  return { get: (key: string) => config[key] } as unknown as ConfigService;
};

describe('mail utils', () => {
  describe('isMailConfigured', () => {
    it('should hold when both the host and the domain are set', () => {
      expect(isMailConfigured(configService())).toBe(true);
    });

    it.each([
      ['SMTP_HOST is missing', { SMTP_HOST: undefined }],
      ['SMTP_HOST is empty', { SMTP_HOST: '' }],
      ['SMTP_FROM_DOMAIN is missing', { SMTP_FROM_DOMAIN: undefined }],
      ['SMTP_FROM_DOMAIN is empty', { SMTP_FROM_DOMAIN: '' }],
    ])('should not hold when %s', (_, overrides) => {
      expect(isMailConfigured(configService(overrides))).toBe(false);
    });
  });

  describe('sender', () => {
    it('should build a declared mailbox on the configured domain', () => {
      expect(sender(configService(), Sender.Noreply)).toBe(
        'noreply@tokenizer.fr',
      );
    });

    it('should follow the domain to another environment', () => {
      const config = configService({
        SMTP_FROM_DOMAIN: 'staging.tokenizer.fr',
      });

      expect(sender(config, Sender.Noreply)).toBe(
        'noreply@staging.tokenizer.fr',
      );
    });

    it('should default to the noreply mailbox', () => {
      expect(DEFAULT_SENDER).toBe(Sender.Noreply);
      expect(sender(configService(), DEFAULT_SENDER)).toBe(
        'noreply@tokenizer.fr',
      );
    });
  });
});

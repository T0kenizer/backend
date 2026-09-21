import { ConfigService } from '@modules/config/config.service';
import * as Types from '@modules/mail/mail.types';

export const isMailConfigured = (configService: ConfigService): boolean =>
  Boolean(
    configService.get('SMTP_HOST') && configService.get('SMTP_FROM_DOMAIN'),
  );

export const sender = (
  configService: ConfigService,
  mailbox: Types.Sender,
): string => `${mailbox}@${configService.get('SMTP_FROM_DOMAIN')}`;

import { ConfigService } from '@modules/config/config.service';
import * as Constants from '@modules/mail/mail.constants';
import { MailConsumer } from '@modules/mail/mail.consumer';
import { MailService } from '@modules/mail/mail.service';
import { isMailConfigured, sender } from '@modules/mail/mail.utils';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { join } from 'path';

@Module({
  imports: [
    BullModule.registerQueue({
      name: Constants.MAIL_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { count: 100, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
      },
    }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const configured = isMailConfigured(config);

        return {
          transport: configured
            ? {
                pool: true,
                maxConnections: Constants.SMTP_MAX_CONNECTIONS,
                maxMessages: Constants.SMTP_MAX_MESSAGES,
                host: config.get('SMTP_HOST'),
                port: config.get('SMTP_PORT'),
                secure: false,
                auth: config.get('SMTP_USER')
                  ? {
                      user: config.get('SMTP_USER'),
                      pass: config.get('SMTP_PASSWORD'),
                    }
                  : undefined,
              }
            : { jsonTransport: true },
          defaults: {
            from: configured
              ? sender(config, Constants.DEFAULT_SENDER)
              : undefined,
          },
          template: {
            dir: join(__dirname, 'templates'),
            adapter: new HandlebarsAdapter(),
            options: { strict: true },
          },
          options: {
            layout: 'partials/base',
            partials: {
              dir: join(__dirname, 'templates', 'partials'),
              options: { strict: true },
            },
          },
        };
      },
    }),
  ],
  providers: [MailConsumer, MailService],
  exports: [MailService],
})
export class MailModule {}

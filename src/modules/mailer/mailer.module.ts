import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerSend } from 'mailersend';
import { MailerService } from './mailer.service';

@Module({
  providers: [
    MailerService,
    {
      provide: 'MAILER',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new MailerSend({
          apiKey: config.get<string>('MAILER_API_KEY'),
        });
      },
    },
  ],
  exports: ['MAILER', MailerService],
})
export class MailerModule {}

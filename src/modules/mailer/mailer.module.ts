import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerSend } from 'mailersend';
import { MailerController } from './mailer.controller';
import { MailerService } from './mailer.service';

@Module({
  controllers: [MailerController],
  providers: [
    {
      provide: 'MAILER',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new MailerSend({
          apiKey: config.get<string>('MAILER_API_KEY') ?? '',
        }),
    },
    MailerService,
  ],
  exports: [MailerService],
})
export class MailerModule {}

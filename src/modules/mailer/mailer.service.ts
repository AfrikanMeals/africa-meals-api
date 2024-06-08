import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailParams, MailerSend, Recipient, Sender } from 'mailersend';
import { SendMailDto } from './dto/mailer.dto';
// https://github.com/mailersend/mailersend-nodejs?tab=readme-ov-file#send-a-template-based-email
@Injectable()
export class MailerService {
  @Inject('MAILER') private readonly _mailer: MailerSend;

  @Inject(ConfigService) private readonly _configService: ConfigService;

  async send(args: SendMailDto) {
    const sentFrom = new Sender(
      this._configService.get<string>('MAILER_SENDER'),
      this._configService.get<string>('APP_NAME'),
    );

    const recipients = [new Recipient(args.to, args.toName)];

    const paramsBuilder = new EmailParams()
      .setFrom(sentFrom)
      .setTo(recipients)
      .setReplyTo(sentFrom)
      .setSubject(args.subject)
      .setTemplateId(args.templateId)
      .setPersonalization([
        {
          email: args.to,
          data: {
            ...args.context,
            support_email: this._configService.get<string>('SUPPORT_EMAIL'),
          },
        },
      ]);

    return this._mailer.email.send(paramsBuilder);
  }
}

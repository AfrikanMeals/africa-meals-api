import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailParams, MailerSend, Recipient, Sender } from 'mailersend';
import * as nodemailer from 'nodemailer';
import { SendMailDto } from './dto/mailer.dto';

export type SendSimpleMailDto = {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  replyToName?: string;
};

// https://github.com/mailersend/mailersend-nodejs?tab=readme-ov-file#send-a-template-based-email
@Injectable()
export class MailerService {
  private readonly _logger = new Logger(MailerService.name);

  @Inject('MAILER') private readonly _mailer: MailerSend;

  @Inject(ConfigService) private readonly _configService: ConfigService;

  /** Gmail / SMTP (voir docs MAIL_SETUP.md) — prioritaire sur MailerSend pour les e-mails simples. */
  private smtpConfigured(): boolean {
    const u = this._configService.get<string>('SMTP_USER')?.trim();
    const p =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim();
    return Boolean(u && p);
  }

  private async sendSimpleSmtp(args: SendSimpleMailDto): Promise<void> {
    const host =
      this._configService.get<string>('SMTP_HOST')?.trim() || 'smtp.gmail.com';
    const portRaw = this._configService.get<string>('SMTP_PORT')?.trim() || '587';
    const port = parseInt(portRaw, 10) || 587;
    const user = this._configService.get<string>('SMTP_USER')!.trim();
    const passRaw =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim() ||
      '';
    const pass = passRaw.replace(/\s/g, '');
    const from =
      this._configService.get<string>('SMTP_FROM')?.trim() || user;
    const appName = this._configService.get<string>('APP_NAME') ?? 'Africa Meals';

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const replyToRaw = args.replyTo?.trim();
    const replyTo =
      replyToRaw && args.replyToName?.trim()
        ? `"${args.replyToName.trim().replace(/"/g, '')}" <${replyToRaw}>`
        : replyToRaw || undefined;

    await transporter.sendMail({
      from: `"${appName}" <${from}>`,
      to: args.to,
      replyTo,
      subject: args.subject,
      html: args.html,
      text: args.text?.trim() || undefined,
    });
  }

  async send(args: SendMailDto) {
    const sentFrom = new Sender(
      this._configService.get<string>('MAILER_SENDER') ?? '',
      this._configService.get<string>('APP_NAME') ?? 'App',
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

  /** E-mail HTML/text sans template (ex. reset password, test). */
  async sendSimple(args: SendSimpleMailDto) {
    if (this.smtpConfigured()) {
      try {
        await this.sendSimpleSmtp(args);
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this._logger.error(`SMTP sendSimple failed: ${msg}`);
        throw new BadGatewayException(`email_send_failed — ${msg}`);
      }
    }

    const apiKey = this._configService.get<string>('MAILER_API_KEY')?.trim();
    const senderEmail = this._configService.get<string>('MAILER_SENDER')?.trim();
    if (!apiKey) {
      throw new BadGatewayException(
        'email_not_configured — SMTP_USER + SMTP_APP_PASSWORD ou MAILER_API_KEY + MAILER_SENDER',
      );
    }
    if (!senderEmail) {
      throw new BadGatewayException(
        'email_not_configured — MAILER_SENDER requis (expéditeur MailerSend vérifié)',
      );
    }

    const appName = this._configService.get<string>('APP_NAME') ?? 'App';
    const sentFrom = new Sender(senderEmail, appName);
    const recipients = [new Recipient(args.to, args.toName ?? args.to)];
    const paramsBuilder = new EmailParams()
      .setFrom(sentFrom)
      .setTo(recipients)
      .setReplyTo(
        args.replyTo?.trim()
          ? new Sender(
              args.replyTo.trim(),
              args.replyToName?.trim() || args.replyTo.trim(),
            )
          : sentFrom,
      )
      .setSubject(args.subject)
      .setHtml(args.html);
    if (args.text?.trim()) {
      paramsBuilder.setText(args.text);
    }

    try {
      return await this._mailer.email.send(paramsBuilder);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._logger.error(`MailerSend sendSimple failed: ${msg}`);
      throw new BadGatewayException(`email_send_failed — ${msg}`);
    }
  }
}

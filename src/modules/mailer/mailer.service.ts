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
import { EmailTemplateService } from './email-template.service';

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type SendSimpleMailDto = {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  replyToName?: string;
  attachments?: MailAttachment[];
};

/** Profil SMTP dédié (ex. notifications publicitaires `AD_SMTP_*`). */
export type SmtpSendProfile = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromDisplayName: string;
};

// https://github.com/mailersend/mailersend-nodejs?tab=readme-ov-file#send-a-template-based-email
@Injectable()
export class MailerService {
  private readonly _logger = new Logger(MailerService.name);

  constructor(
    @Inject('MAILER') private readonly _mailer: MailerSend,
    private readonly _configService: ConfigService,
    private readonly _emailTemplate: EmailTemplateService,
  ) {}

  private prepareHtml(html: string, subject: string): string {
    if (!this._emailTemplate.shouldWrap(html)) {
      return html;
    }
    return this._emailTemplate.wrapBody(html, {
      title: subject,
      preheader: subject,
    });
  }

  /** Gmail / SMTP (voir docs MAIL_SETUP.md) — prioritaire sur MailerSend pour les e-mails simples. */
  private smtpConfigured(): boolean {
    return this.readDefaultSmtpProfile() != null;
  }

  /** Profil `AD_SMTP_*` pour les e-mails marketing / notifications ads. */
  readAdNotificationSmtpProfile(): SmtpSendProfile | null {
    const user = this._configService.get<string>('AD_SMTP_USER')?.trim() ?? '';
    const passRaw =
      this._configService.get<string>('AD_SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('AD_SMTP_PASS')?.trim() ||
      '';
    const pass = passRaw.replace(/\s/g, '');
    if (!user || !pass) return null;
    const from =
      this._configService.get<string>('AD_SMTP_FROM')?.trim() || user;
    const host =
      this._configService.get<string>('AD_SMTP_HOST')?.trim() ||
      this._configService.get<string>('SMTP_HOST')?.trim() ||
      'smtp.gmail.com';
    const portRaw =
      this._configService.get<string>('AD_SMTP_PORT')?.trim() ||
      this._configService.get<string>('SMTP_PORT')?.trim() ||
      '587';
    const port = parseInt(portRaw, 10) || 587;
    const fromDisplayName =
      this._configService.get<string>('AD_SMTP_FROM_NAME')?.trim() ||
      this._configService.get<string>('APP_NAME')?.trim() ||
      'Wise Eat';
    return { host, port, user, pass, from, fromDisplayName };
  }

  private readDefaultSmtpProfile(): SmtpSendProfile | null {
    const user = this._configService.get<string>('SMTP_USER')?.trim() ?? '';
    const passRaw =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim() ||
      '';
    const pass = passRaw.replace(/\s/g, '');
    if (!user || !pass) return null;
    const from =
      this._configService.get<string>('SMTP_FROM')?.trim() || user;
    const host =
      this._configService.get<string>('SMTP_HOST')?.trim() || 'smtp.gmail.com';
    const portRaw =
      this._configService.get<string>('SMTP_PORT')?.trim() || '587';
    const port = parseInt(portRaw, 10) || 587;
    const fromDisplayName =
      this._configService.get<string>('APP_NAME')?.trim() || 'Africa Meals';
    return { host, port, user, pass, from, fromDisplayName };
  }

  private async sendSimpleSmtp(
    args: SendSimpleMailDto,
    profile: SmtpSendProfile,
  ): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: profile.host,
      port: profile.port,
      secure: profile.port === 465,
      auth: { user: profile.user, pass: profile.pass },
    });

    const replyToRaw = args.replyTo?.trim();
    const replyTo =
      replyToRaw && args.replyToName?.trim()
        ? `"${args.replyToName.trim().replace(/"/g, '')}" <${replyToRaw}>`
        : replyToRaw || undefined;

    await transporter.sendMail({
      from: `"${profile.fromDisplayName}" <${profile.from}>`,
      to: args.to,
      replyTo,
      subject: args.subject,
      html: args.html,
      text: args.text?.trim() || undefined,
      attachments: (args.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType:
          a.contentType ??
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })),
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

  /**
   * E-mails des notifications publicitaires — SMTP `AD_SMTP_*` (expéditeur sales/marketing).
   */
  async sendAdNotificationEmail(args: SendSimpleMailDto): Promise<void> {
    const profile = this.readAdNotificationSmtpProfile();
    if (!profile) {
      throw new BadGatewayException(
        'ad_email_not_configured — AD_SMTP_USER et AD_SMTP_APP_PASSWORD requis',
      );
    }
    const prepared: SendSimpleMailDto = {
      ...args,
      html: this.prepareHtml(args.html, args.subject),
      replyTo: args.replyTo ?? profile.from,
      replyToName: args.replyToName ?? profile.fromDisplayName,
    };
    try {
      await this.sendSimpleSmtp(prepared, profile);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._logger.error(`AD SMTP send failed: ${msg}`);
      throw new BadGatewayException(`email_send_failed — ${msg}`);
    }
  }

  /** E-mail HTML/text sans template (ex. reset password, test). */
  async sendSimple(args: SendSimpleMailDto) {
    const prepared: SendSimpleMailDto = {
      ...args,
      html: this.prepareHtml(args.html, args.subject),
    };
    const smtpProfile = this.readDefaultSmtpProfile();
    if (smtpProfile) {
      try {
        await this.sendSimpleSmtp(prepared, smtpProfile);
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this._logger.error(`SMTP sendSimple failed: ${msg}`);
        throw new BadGatewayException(`email_send_failed — ${msg}`);
      }
    }

    const apiKey = this._configService.get<string>('MAILER_API_KEY')?.trim();
    const senderEmail = this._configService
      .get<string>('MAILER_SENDER')
      ?.trim();
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
      .setSubject(prepared.subject)
      .setHtml(prepared.html);
    if (prepared.text?.trim()) {
      paramsBuilder.setText(prepared.text);
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

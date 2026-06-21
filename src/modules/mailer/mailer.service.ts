import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailParams, MailerSend, Recipient, Sender } from 'mailersend';
import * as nodemailer from 'nodemailer';
import type { EmailAppModuleId } from '@modules/platform-channels/email-module.registry';
import { SendMailDto } from './dto/mailer.dto';
import { EmailDispatchService } from './email-dispatch.service';
import { EmailTemplateService } from './email-template.service';

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type SendSimpleMailDto = {
  to: string;
  toName?: string;
  /** Copie (e-mails boutique, etc.). */
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  replyToName?: string;
  attachments?: MailAttachment[];
  /** Préfixe de logs (ex. vendor-ops-report-manual). */
  logContext?: string;
  /** Module applicatif pour la résolution du moteur e-mail. */
  emailModule?: EmailAppModuleId;
  /** Bannière hero sous l'en-tête (illustration IA onboarding, etc.). */
  heroImageUrl?: string;
  heroImageAlt?: string;
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
    private readonly _emailDispatch: EmailDispatchService,
  ) {}

  private prepareHtml(html: string, subject: string, args?: Pick<SendSimpleMailDto, 'heroImageUrl' | 'heroImageAlt'>): string {
    if (!this._emailTemplate.shouldWrap(html)) {
      return html;
    }
    return this._emailTemplate.wrapBody(html, {
      title: subject,
      preheader: subject,
      heroImageUrl: args?.heroImageUrl,
      heroImageAlt: args?.heroImageAlt,
    });
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
      'smtp.zoho.com';
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

    const cc =
      args.cc?.map((e) => e.trim()).filter(Boolean) ?? [];

    await transporter.sendMail({
      from: `"${profile.fromDisplayName}" <${profile.from}>`,
      to: args.to,
      cc: cc.length > 0 ? cc : undefined,
      replyTo,
      subject: args.subject,
      html: args.html,
      text: args.text?.trim() || undefined,
      attachments: (args.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType:
          a.contentType ??
          (/\.pdf$/i.test(a.filename)
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
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
    const prepared: SendSimpleMailDto = {
      ...args,
      html: this.prepareHtml(args.html, args.subject, args),
      replyTo: args.replyTo ?? profile?.from,
      replyToName: args.replyToName ?? profile?.fromDisplayName,
    };

    if (profile) {
      try {
        await this.sendSimpleSmtp(prepared, profile);
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this._logger.warn(
          `AD SMTP en échec, bascule vers le dispatcher Ads: ${msg}`,
        );
      }
    }

    await this._emailDispatch.sendSimple({
      ...prepared,
      logContext: args.logContext,
      emailModule: 'ads',
    });
  }

  /** E-mail HTML/text sans template — dispatcher multi-moteurs avec bascule. */
  async sendSimple(args: SendSimpleMailDto) {
    const { logContext, emailModule, heroImageUrl, heroImageAlt, ...mailArgs } =
      args;
    const prepared = {
      ...mailArgs,
      logContext,
      emailModule,
      html: this.prepareHtml(mailArgs.html, mailArgs.subject, {
        heroImageUrl,
        heroImageAlt,
      }),
    };
    const ccList = prepared.cc?.map((e) => e.trim()).filter(Boolean) ?? [];
    if (logContext) {
      const ccPart = ccList.length > 0 ? ` cc=${ccList.join(', ')}` : '';
      this._logger.log(
        `[${logContext}] envoi → to=${prepared.to}${ccPart} subject="${prepared.subject}"`,
      );
    }
    await this._emailDispatch.sendSimple(prepared);
  }
}

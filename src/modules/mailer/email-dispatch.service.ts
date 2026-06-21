import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sendBirdEmailMessage } from '@modules/ads/bird-channels.util';
import {
  EMAIL_ENGINE_BIRD,
  EMAIL_ENGINE_DEFAULT,
  EMAIL_ENGINE_RESEND,
  EMAIL_ENGINE_SENDGRID,
  smtpConfigIdFromEngine,
} from '@modules/platform-channels/email-engine.util';
import type { EmailAppModuleId } from '@modules/platform-channels/email-module.registry';
import { inferEmailModuleFromLogContext } from '@modules/platform-channels/email-module.registry';
import type {
  DispatchSimpleMailPayload,
  SmtpSendProfile,
} from '@modules/platform-channels/email-send.types';
import { PlatformChannelsService } from '@modules/platform-channels/platform-channels.service';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { EmailParams, MailerSend, Recipient, Sender } from 'mailersend';
import * as nodemailer from 'nodemailer';

export type EmailDispatchSendArgs = DispatchSimpleMailPayload & {
  emailModule?: EmailAppModuleId;
};

@Injectable()
export class EmailDispatchService {
  private readonly logger = new Logger(EmailDispatchService.name);

  constructor(
    private readonly platformChannels: PlatformChannelsService,
    private readonly secrets: SecretManagerService,
    private readonly config: ConfigService,
    @Inject('MAILER') private readonly mailerSend: MailerSend,
  ) {}

  async sendSimple(args: EmailDispatchSendArgs): Promise<void> {
    const moduleId =
      args.emailModule ?? inferEmailModuleFromLogContext(args.logContext);
    const chain = await this.platformChannels.resolveEmailDispatchChain(
      moduleId ?? null,
    );

    if (!chain.length) {
      throw new BadGatewayException(
        'email_not_configured — aucun moteur e-mail configuré',
      );
    }

    const errors: string[] = [];
    for (const engine of chain) {
      try {
        await this.sendViaEngine(engine, args);
        const logSuffix = args.logContext ? ` [${args.logContext}]` : '';
        this.logger.log(
          `E-mail envoyé via ${engine} → ${args.to}${logSuffix}`,
        );
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${engine}: ${msg}`);
        this.logger.warn(
          `Moteur ${engine} en échec${args.logContext ? ` (${args.logContext})` : ''}: ${msg}`,
        );
      }
    }

    throw new BadGatewayException(
      `email_send_failed — ${errors.join(' | ')}`,
    );
  }

  private async sendViaEngine(
    engine: string,
    args: DispatchSimpleMailPayload,
  ): Promise<void> {
    if (engine === 'mailersend') {
      await this.sendViaMailerSend(args);
      return;
    }
    if (engine === EMAIL_ENGINE_DEFAULT) {
      const profile = await this.platformChannels.readDefaultSmtpSendProfile();
      if (!profile) throw new Error('default_smtp_not_configured');
      await this.sendViaSmtp(args, profile);
      return;
    }
    if (engine === EMAIL_ENGINE_BIRD) {
      await this.sendViaBird(args);
      return;
    }
    if (engine === EMAIL_ENGINE_RESEND) {
      await this.sendViaResend(args);
      return;
    }
    if (engine === EMAIL_ENGINE_SENDGRID) {
      await this.sendViaSendgrid(args);
      return;
    }
    const smtpId = smtpConfigIdFromEngine(engine);
    if (smtpId) {
      const profile =
        await this.platformChannels.readPlatformSmtpSendProfile(smtpId);
      if (!profile) throw new Error(`smtp_config_not_configured:${smtpId}`);
      await this.sendViaSmtp(args, profile);
      return;
    }
    throw new Error(`unknown_email_engine:${engine}`);
  }

  private resolveFromAddress(profile?: {
    from: string;
    fromDisplayName: string;
  }): { from: string; name: string; formatted: string } {
    const from =
      profile?.from?.trim() ||
      this.config.get<string>('SMTP_FROM')?.trim() ||
      this.config.get<string>('SMTP_USER')?.trim() ||
      this.config.get<string>('MAILER_SENDER')?.trim() ||
      '';
    const name =
      profile?.fromDisplayName?.trim() ||
      this.config.get<string>('APP_NAME')?.trim() ||
      'Wise Eat';
    if (!from) throw new Error('sender_from_missing');
    return { from, name, formatted: `"${name}" <${from}>` };
  }

  private async sendViaSmtp(
    args: DispatchSimpleMailPayload,
    profile: SmtpSendProfile,
  ): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: profile.host,
      port: profile.port,
      secure: profile.secure === true || profile.port === 465,
      auth: { user: profile.user, pass: profile.pass },
    });

    const replyToRaw = args.replyTo?.trim();
    const replyTo =
      replyToRaw && args.replyToName?.trim()
        ? `"${args.replyToName.trim().replace(/"/g, '')}" <${replyToRaw}>`
        : replyToRaw || undefined;
    const cc = args.cc?.map((e) => e.trim()).filter(Boolean) ?? [];

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

  private async sendViaBird(args: DispatchSimpleMailPayload): Promise<void> {
    const config = await this.platformChannels.getBirdEmailConfig();
    if (!config) throw new Error('bird_email_not_configured');
    await sendBirdEmailMessage({
      config,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
  }

  private async sendViaResend(args: DispatchSimpleMailPayload): Promise<void> {
    const apiKey = await this.secrets.resolveString('api', 'RESEND_API_KEY');
    if (!apiKey.trim()) throw new Error('resend_not_configured');
    const sender = this.resolveFromAddress();

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sender.formatted,
        to: [args.to],
        cc: args.cc?.filter(Boolean),
        subject: args.subject,
        html: args.html,
        text: args.text?.trim() || undefined,
        reply_to: args.replyTo?.trim() || undefined,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `Resend HTTP ${res.status}`);
    }
  }

  private async sendViaSendgrid(args: DispatchSimpleMailPayload): Promise<void> {
    const apiKey = await this.secrets.resolveString('api', 'SENDGRID_API_KEY');
    if (!apiKey.trim()) throw new Error('sendgrid_not_configured');
    const sender = this.resolveFromAddress();
    const cc = args.cc?.map((e) => e.trim()).filter(Boolean) ?? [];

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: args.to, name: args.toName ?? args.to }],
            ...(cc.length ? { cc: cc.map((email) => ({ email })) } : {}),
          },
        ],
        from: { email: sender.from, name: sender.name },
        reply_to: args.replyTo?.trim()
          ? { email: args.replyTo.trim(), name: args.replyToName ?? args.replyTo.trim() }
          : undefined,
        subject: args.subject,
        content: [
          ...(args.text?.trim()
            ? [{ type: 'text/plain', value: args.text.trim() }]
            : []),
          { type: 'text/html', value: args.html },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `SendGrid HTTP ${res.status}`);
    }
  }

  private async sendViaMailerSend(args: DispatchSimpleMailPayload): Promise<void> {
    const apiKey = this.config.get<string>('MAILER_API_KEY')?.trim();
    const senderEmail = this.config.get<string>('MAILER_SENDER')?.trim();
    if (!apiKey || !senderEmail) throw new Error('mailersend_not_configured');

    const appName = this.config.get<string>('APP_NAME') ?? 'App';
    const sentFrom = new Sender(senderEmail, appName);
    const recipients = [new Recipient(args.to, args.toName ?? args.to)];
    const ccRecipients =
      args.cc?.map((email) => new Recipient(email, email)) ?? [];

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
    if (ccRecipients.length > 0) {
      paramsBuilder.setCc(ccRecipients);
    }
    if (args.text?.trim()) {
      paramsBuilder.setText(args.text);
    }

    await this.mailerSend.email.send(paramsBuilder);
  }
}

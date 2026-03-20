import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { SendMailDto } from './dto/mailer.dto';

@Injectable()
export class MailerService {
  private _transport: Transporter | null = null;

  constructor(private readonly _configService: ConfigService) {}

  private _getTransport(): Transporter {
    if (this._transport) return this._transport;

    const host = this._configService.get<string>('SMTP_HOST', 'smtp.gmail.com');
    const port = this._configService.get<number>('SMTP_PORT', 587);
    const secure = port === 465;
    const user = this._configService.get<string>('SMTP_USER');
    const pass =
      this._configService.get<string>('SMTP_APP_PASSWORD') ||
      this._configService.get<string>('SMTP_PASS');

    if (!user || !pass) {
      throw new Error(
        'SMTP_USER and (SMTP_APP_PASSWORD or SMTP_PASS) must be set in .env for email sending',
      );
    }

    this._transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    return this._transport;
  }

  /**
   * Envoi d'un email avec contexte (utilisé pour vérification de compte, etc.).
   * Avec Gmail SMTP il n'y a pas de templates externes : le HTML est généré ici.
   */
  async send(args: SendMailDto) {
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'African Meals';
    const supportEmail =
      this._configService.get<string>('SUPPORT_EMAIL') ?? '';
    const { name, code, ...rest } = args.context || {};
    const html = this._buildHtmlFromContext({
      name: name ?? 'Utilisateur',
      code: code ?? '',
      support_email: supportEmail,
      app_name: appName,
      ...rest,
    });
    const text = `Bonjour ${name ?? 'Utilisateur'}, votre code : ${code ?? ''}. Support : ${supportEmail}`;

    return this.sendSimple({
      to: args.to,
      toName: args.toName,
      subject: args.subject,
      html,
      text,
    });
  }

  private _buildHtmlFromContext(ctx: Record<string, unknown>): string {
    const name = (ctx.name as string) ?? 'Utilisateur';
    const code = (ctx.code as string) ?? '';
    const supportEmail = (ctx.support_email as string) ?? '';
    const appName = (ctx.app_name as string) ?? 'African Meals';

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${appName}</title></head>
<body style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #393828;">Bienvenue sur ${appName}</h2>
  <p>Bonjour <strong>${name}</strong>,</p>
  <p>Votre code de vérification est : <strong style="font-size: 1.2em; letter-spacing: 2px;">${code}</strong>.</p>
  <p>Entrez ce code dans l'application pour activer votre compte.</p>
  <p>Si vous n'avez pas créé de compte, ignorez cet email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="font-size: 12px; color: #666;">Support : ${supportEmail}</p>
</body>
</html>
    `.trim();
  }

  /**
   * Envoi d'un email simple (HTML et/ou texte).
   */
  async sendSimple(args: {
    to: string;
    toName?: string;
    subject: string;
    html?: string;
    text?: string;
  }) {
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'African Meals';
    const from = this._configService.get<string>('SMTP_FROM');
    const user = this._configService.get<string>('SMTP_USER');

    const transport = this._getTransport();
    const fromAddress = from || user;
    if (!fromAddress) {
      throw new Error('SMTP_FROM or SMTP_USER must be set');
    }

    const mailOptions: nodemailer.SendMailOptions = {
      from: `"${appName}" <${fromAddress}>`,
      to: args.toName ? `"${args.toName}" <${args.to}>` : args.to,
      subject: args.subject,
      html: args.html,
      text: args.text ?? args.html?.replace(/<[^>]*>/g, '') ?? args.subject,
    };

    return transport.sendMail(mailOptions);
  }
}

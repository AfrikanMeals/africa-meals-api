import { AuthSettingsService } from '@modules/auth-settings/auth-settings.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserModel } from '@schemas/user.schema';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  formatLoginGeo,
  lookupLoginGeo,
} from './login-geo.lookup';
import {
  type LoginAuthMethod,
  type LoginRequestContext,
  loginMethodLabel,
} from './login-request-context.util';

dayjs.extend(utc);
dayjs.extend(timezone);

type LoginUserSnapshot = Pick<UserModel, '_id' | 'email' | 'fullName' | 'type'>;

@Injectable()
export class LoginNotificationService {
  private readonly logger = new Logger(LoginNotificationService.name);

  constructor(
    private readonly authSettings: AuthSettingsService,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    private readonly config: ConfigService,
  ) {}

  maybeNotifyLogin(
    user: LoginUserSnapshot,
    ctx: LoginRequestContext,
    method: LoginAuthMethod,
  ): void {
    void this._notifyLogin(user, ctx, method).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`login notification skipped: ${msg}`);
    });
  }

  private async _notifyLogin(
    user: LoginUserSnapshot,
    ctx: LoginRequestContext,
    method: LoginAuthMethod,
  ): Promise<void> {
    const settings = await this.authSettings.getPublicSettings();
    if (ctx.channel === 'admin' && settings.loginEmailNotifyAdminEnabled === false) {
      return;
    }
    if (ctx.channel === 'mobile' && settings.loginEmailNotifyMobileEnabled === false) {
      return;
    }

    const email = String(user.email ?? '')
      .trim()
      .toLowerCase();
    if (!email) return;

    const geo = await lookupLoginGeo(ctx.ipAddress);
    const tz = geo?.timezone || 'UTC';
    const occurredAt = dayjs().tz(tz);
    const appName = this.config.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const channelLabel = ctx.channel === 'admin' ? 'Tableau de bord admin' : 'Application mobile';
    const deviceLine = [
      ctx.deviceType,
      ctx.os,
      ctx.browser,
      ctx.clientDevice ? `(${ctx.clientDevice})` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    const rows = [
      { label: 'Compte', value: String(user.fullName ?? email) },
      { label: 'E-mail', value: email },
      { label: 'Canal', value: channelLabel },
      { label: 'Méthode', value: loginMethodLabel(method) },
      { label: 'Date et heure', value: occurredAt.format('YYYY-MM-DD HH:mm:ss Z') },
      { label: 'Fuseau horaire', value: tz },
      { label: 'Adresse IP', value: ctx.ipAddress },
      { label: 'Appareil', value: deviceLine || 'Inconnu' },
      { label: 'User-Agent', value: ctx.userAgent },
      { label: 'Localisation (IP)', value: formatLoginGeo(geo) },
    ];
    if (ctx.dashboardPath) {
      rows.splice(4, 0, { label: 'Page admin', value: ctx.dashboardPath });
    }

    const safeName = this.emailTpl.escapeHtml(String(user.fullName ?? email));
    const html = [
      this.emailTpl.heading('Nouvelle connexion'),
      this.emailTpl.paragraph(
        `Bonjour <strong>${safeName}</strong>, une connexion à votre compte <strong>${this.emailTpl.escapeHtml(appName)}</strong> vient d’être effectuée.`,
      ),
      this.emailTpl.paragraph(
        'Si vous n’êtes pas à l’origine de cette connexion, changez votre mot de passe immédiatement et contactez le support.',
      ),
      this.emailTpl.infoPanel(this.emailTpl.keyValues(rows)),
      this.emailTpl.muted(
        'Cet e-mail est envoyé automatiquement pour votre sécurité. La localisation est estimée à partir de l’adresse IP et peut être approximative.',
      ),
    ].join('');

    await this.mailer.sendSimple({
      to: email,
      toName: String(user.fullName ?? email),
      subject: `[${appName}] Connexion ${channelLabel}`,
      html,
      logContext: 'login-notification',
    });
  }
}

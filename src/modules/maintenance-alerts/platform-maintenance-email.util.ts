import { resolveEmailBrand } from '@modules/mailer/email-brand.util';
import { ConfigService } from '@nestjs/config';
import { MaintenancePlatformEnum } from '@schemas/platform-maintenance.schema';

const HERO_FILES = {
  on: 'maintenance-mode-on.png',
  off: 'maintenance-mode-off.png',
} as const;

export function resolveMaintenanceModeHeroUrl(args: {
  config: ConfigService;
  enabled: boolean;
}): string {
  const brand = resolveEmailBrand(args.config);
  const base =
    brand.websiteUrl?.replace(/\/+$/, '') ||
    args.config.get<string>('EMAIL_WEBSITE_URL')?.trim()?.replace(/\/+$/, '') ||
    'https://wise-eat.com';
  const file = args.enabled ? HERO_FILES.on : HERO_FILES.off;
  return `${base}/images/email-heroes/${file}`;
}

export function maintenancePlatformLabel(
  platform: MaintenancePlatformEnum,
): string {
  switch (platform) {
    case MaintenancePlatformEnum.VENDOR:
      return 'Vendeur (Vendor)';
    case MaintenancePlatformEnum.DELIVERY:
      return 'Livraison (Delivery)';
    case MaintenancePlatformEnum.CUSTOMER:
      return 'Client (Customer)';
    default:
      return platform;
  }
}

export function buildMaintenanceModeEmail(args: {
  appName: string;
  platform: MaintenancePlatformEnum;
  enabled: boolean;
  message: string;
  actorEmail: string;
  toggledAt: string;
}): { subject: string; html: string; text: string; heroImageAlt: string } {
  const platformLabel = maintenancePlatformLabel(args.platform);
  const statusLabel = args.enabled ? 'activé' : 'désactivé';
  const subject = `[${args.appName}] Mode maintenance ${statusLabel} — ${platformLabel}`;

  const intro = args.enabled
    ? `Le mode maintenance a été <strong>activé</strong> pour la plateforme <strong>${escapeHtml(platformLabel)}</strong>.`
    : `Le mode maintenance a été <strong>désactivé</strong> pour la plateforme <strong>${escapeHtml(platformLabel)}</strong>.`;

  const messageBlock = args.message.trim()
    ? `<p><strong>Message affiché aux utilisateurs :</strong><br/>${escapeHtml(args.message.trim()).replace(/\n/g, '<br/>')}</p>`
    : '';

  const html = [
    `<p>${intro}</p>`,
    `<p><strong>Action par :</strong> ${escapeHtml(args.actorEmail || 'admin')}</p>`,
    `<p><strong>Date :</strong> ${escapeHtml(args.toggledAt)}</p>`,
    messageBlock,
    `<p style="color:#6b7280;font-size:13px">Les applications mobile/web de cette plateforme peuvent afficher un écran de maintenance tant que le mode est actif.</p>`,
  ]
    .filter(Boolean)
    .join('');

  const text = [
    args.enabled
      ? `Mode maintenance ACTIVÉ — ${platformLabel}`
      : `Mode maintenance DÉSACTIVÉ — ${platformLabel}`,
    `Action par : ${args.actorEmail || 'admin'}`,
    `Date : ${args.toggledAt}`,
    args.message.trim() ? `Message : ${args.message.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    html,
    text,
    heroImageAlt: args.enabled
      ? `Mode maintenance activé — ${platformLabel}`
      : `Mode maintenance désactivé — ${platformLabel}`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

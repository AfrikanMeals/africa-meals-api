import type { PlatformSmtpConfigModel } from '@schemas/platform-smtp-config.schema';

export type SmtpPasswordField = {
  value: string;
  source: 'database' | 'env' | 'none';
  configured: boolean;
  preview: string | null;
};

export const EMAIL_ENGINE_ANY = 'any';
export const EMAIL_ENGINE_AUTO = 'auto';
export const EMAIL_ENGINE_DEFAULT = 'default';
export const EMAIL_ENGINE_BIRD = 'bird';
export const EMAIL_ENGINE_RESEND = 'resend';
export const EMAIL_ENGINE_SENDGRID = 'sendgrid';
export const EMAIL_ENGINE_SMTP_PREFIX = 'smtp:';

export type EmailEngineOption = {
  value: string;
  label: string;
  hint: string;
  kind: 'builtin' | 'smtp';
  configured: boolean;
  smtpConfigId?: string;
};

export type EmailModuleEngineRow = {
  moduleId: string;
  label: string;
  hint: string;
  engine: string;
};

export type PlatformSmtpConfigView = {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  from: string;
  fromName: string;
  secure: boolean;
  configured: boolean;
  password: SmtpPasswordField;
};

export function smtpConfigSecretKey(configId: string): string {
  const safe = String(configId ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 24);
  return `PLATFORM_SMTP_${safe || 'CFG'}_APP_PASSWORD`;
}

export function isSmtpEngineValue(value: string): boolean {
  return value.startsWith(EMAIL_ENGINE_SMTP_PREFIX);
}

export function smtpEngineValue(configId: string): string {
  return `${EMAIL_ENGINE_SMTP_PREFIX}${configId}`;
}

export function smtpConfigIdFromEngine(value: string): string | null {
  if (!isSmtpEngineValue(value)) return null;
  const id = value.slice(EMAIL_ENGINE_SMTP_PREFIX.length).trim();
  return id || null;
}

export function normalizeEmailEngine(
  raw: string | null | undefined,
  smtpConfigs: PlatformSmtpConfigModel[],
  fallback: string = EMAIL_ENGINE_AUTO,
): string {
  const value = String(raw ?? fallback).trim();
  if (
    value === EMAIL_ENGINE_ANY ||
    value === EMAIL_ENGINE_AUTO ||
    value === EMAIL_ENGINE_DEFAULT ||
    value === EMAIL_ENGINE_BIRD ||
    value === EMAIL_ENGINE_RESEND ||
    value === EMAIL_ENGINE_SENDGRID
  ) {
    return value;
  }
  const smtpId = smtpConfigIdFromEngine(value);
  if (smtpId && smtpConfigs.some((c) => c.id === smtpId)) {
    return smtpEngineValue(smtpId);
  }
  return fallback;
}

export function normalizeEmailModuleEngine(
  raw: string | null | undefined,
  smtpConfigs: PlatformSmtpConfigModel[],
): string {
  return normalizeEmailEngine(raw, smtpConfigs, EMAIL_ENGINE_ANY);
}

export function buildEmailEngineOptions(args: {
  defaultSmtpConfigured: boolean;
  birdEmailConfigured: boolean;
  resendConfigured: boolean;
  sendgridConfigured: boolean;
  smtpConfigs: PlatformSmtpConfigView[];
}): EmailEngineOption[] {
  const smtpConfiguredCount =
    (args.defaultSmtpConfigured ? 1 : 0) +
    args.smtpConfigs.filter((c) => c.configured).length;
  const allConfiguredCount =
    smtpConfiguredCount +
    (args.birdEmailConfigured ? 1 : 0) +
    (args.resendConfigured ? 1 : 0) +
    (args.sendgridConfigured ? 1 : 0);

  const options: EmailEngineOption[] = [
    {
      value: EMAIL_ENGINE_ANY,
      label: 'Any Engine',
      hint: 'Choisit aléatoirement parmi tous les moteurs configurés (SMTP, Bird, Resend, SendGrid).',
      kind: 'builtin',
      configured: allConfiguredCount >= 2,
    },
    {
      value: EMAIL_ENGINE_AUTO,
      label: 'Auto',
      hint: 'Choisit aléatoirement parmi les SMTP (Default + configurations additionnelles).',
      kind: 'builtin',
      configured: smtpConfiguredCount >= 1,
    },
    {
      value: EMAIL_ENGINE_DEFAULT,
      label: 'Default',
      hint: 'SMTP par défaut depuis les variables d’environnement (SMTP_*).',
      kind: 'builtin',
      configured: args.defaultSmtpConfigured,
    },
  ];

  for (const cfg of args.smtpConfigs) {
    options.push({
      value: smtpEngineValue(cfg.id),
      label: cfg.label,
      hint: `${cfg.host}:${cfg.port} · ${cfg.user}`,
      kind: 'smtp',
      configured: cfg.configured,
      smtpConfigId: cfg.id,
    });
  }

  options.push(
    {
      value: EMAIL_ENGINE_BIRD,
      label: 'Bird Email API',
      hint: 'Bird Channels API — e-mail (BIRD_ACCESS_KEY, BIRD_WORKSPACE_ID, BIRD_EMAIL_CHANNEL_ID).',
      kind: 'builtin',
      configured: args.birdEmailConfigured,
    },
    {
      value: EMAIL_ENGINE_RESEND,
      label: 'Resend',
      hint: 'API Resend (RESEND_API_KEY).',
      kind: 'builtin',
      configured: args.resendConfigured,
    },
    {
      value: EMAIL_ENGINE_SENDGRID,
      label: 'SendGrid',
      hint: 'API SendGrid (SENDGRID_API_KEY).',
      kind: 'builtin',
      configured: args.sendgridConfigured,
    },
  );

  return options;
}

import { SecretManagerScope } from '@schemas/secret-manager.schema';

export type SecretKeyDefinition = {
  envVarName: string;
  label: string;
  description: string;
  category: string;
  /** Nécessite .env au démarrage (ex. connexion Mongo avant lecture DB). */
  bootstrapOnly?: boolean;
  /** Non modifiable via Secret Manager (toujours .env). */
  readOnly?: boolean;
};

/** Connexion MongoDB — jamais stockée ni pilotée depuis Secret Manager. */
export const MONGODB_SECRET_ENV_KEYS = [
  'MONGODB_URI',
  'MONGO_URI',
  'DB_HOST',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
] as const;

export function isMongoDbSecretKey(envVarName: string): boolean {
  return (MONGODB_SECRET_ENV_KEYS as readonly string[]).includes(
    envVarName.trim(),
  );
}

export const API_SECRET_REGISTRY: SecretKeyDefinition[] = [
  {
    envVarName: 'MONGODB_URI',
    label: 'MongoDB — URI',
    description: 'URI de connexion MongoDB complète. Uniquement via .env (requis avant accès à la base).',
    category: 'MongoDB',
    readOnly: true,
  },
  {
    envVarName: 'DB_HOST',
    label: 'MongoDB — hôte',
    description: 'Hôte MongoDB Atlas (composant URI). Uniquement via .env.',
    category: 'MongoDB',
    readOnly: true,
  },
  {
    envVarName: 'DB_USERNAME',
    label: 'MongoDB — utilisateur',
    description: 'Utilisateur MongoDB. Uniquement via .env.',
    category: 'MongoDB',
    readOnly: true,
  },
  {
    envVarName: 'DB_PASSWORD',
    label: 'MongoDB — mot de passe',
    description: 'Mot de passe MongoDB. Uniquement via .env.',
    category: 'MongoDB',
    readOnly: true,
  },
  {
    envVarName: 'DB_DATABASE',
    label: 'MongoDB — base',
    description: 'Nom de la base MongoDB. Uniquement via .env.',
    category: 'MongoDB',
    readOnly: true,
  },
  {
    envVarName: 'STRIPE_SECRET_KEY',
    label: 'Stripe — clé secrète',
    description: 'Clé secrète Stripe (sk_test_… / sk_live_…).',
    category: 'Paiements',
  },
  {
    envVarName: 'STRIPE_WEBHOOK_SECRET',
    label: 'Stripe — webhook',
    description: 'Secret de signature des webhooks Stripe (whsec_…).',
    category: 'Paiements',
  },
  {
    envVarName: 'PAYPAL_CLIENT_SECRET',
    label: 'PayPal — client secret',
    description: 'Secret client PayPal pour les paiements.',
    category: 'Paiements',
  },
  {
    envVarName: 'JWT_SECRET',
    label: 'JWT — secret',
    description: 'Signature des tokens JWT. Requis au démarrage si Mongo indisponible.',
    category: 'Authentification',
    bootstrapOnly: true,
  },
  {
    envVarName: 'JWT_REFRESH_SECRET',
    label: 'JWT — refresh secret',
    description: 'Signature des refresh tokens.',
    category: 'Authentification',
  },
  {
    envVarName: 'INTERNAL_NOTIFY_SECRET',
    label: 'Secret interne API ↔ WS',
    description: 'Authentifie les appels internes entre l’API et le WebSocket.',
    category: 'Interne',
  },
  {
    envVarName: 'SMTP_APP_PASSWORD',
    label: 'SMTP — mot de passe application',
    description: 'Mot de passe d’application SMTP (Gmail, etc.).',
    category: 'E-mail',
  },
  {
    envVarName: 'SMTP_PASS',
    label: 'SMTP — mot de passe',
    description: 'Mot de passe SMTP alternatif.',
    category: 'E-mail',
  },
  {
    envVarName: 'RESEND_API_KEY',
    label: 'Resend — clé API',
    description: 'Clé API Resend pour l’envoi d’e-mails transactionnels.',
    category: 'E-mail',
  },
  {
    envVarName: 'SENDGRID_API_KEY',
    label: 'SendGrid — clé API',
    description: 'Clé API SendGrid pour l’envoi d’e-mails transactionnels.',
    category: 'E-mail',
  },
  {
    envVarName: 'MAPBOX_ACCESS_TOKEN',
    label: 'Mapbox — token',
    description: 'Token d’accès Mapbox pour la géolocalisation.',
    category: 'Cartographie',
  },
  {
    envVarName: 'OPENAI_API_KEY',
    label: 'OpenAI — clé API',
    description: 'Clé API OpenAI (embeddings, IA).',
    category: 'Intelligence artificielle',
  },
  {
    envVarName: 'SEARCH_EMBEDDING_API_KEY',
    label: 'Recherche — clé embedding',
    description: 'Clé dédiée aux embeddings de recherche vectorielle.',
    category: 'Intelligence artificielle',
  },
  {
    envVarName: 'GEMINI_API_KEY',
    label: 'Gemini — clé API',
    description: 'Clé Google Gemini (images onboarding, etc.).',
    category: 'Intelligence artificielle',
  },
  {
    envVarName: 'RECAPTCHA_ENTERPRISE_API_KEY',
    label: 'reCAPTCHA Enterprise — clé API',
    description: 'Clé API pour la validation reCAPTCHA Enterprise.',
    category: 'Sécurité',
  },
  {
    envVarName: 'BIRD_ACCESS_KEY',
    label: 'Bird — clé d’accès',
    description: 'Clé API Bird pour SMS / WhatsApp.',
    category: 'Messagerie',
  },
  {
    envVarName: 'TELEGRAM_BOT_TOKEN',
    label: 'Telegram — token bot',
    description: 'Token Bot API Telegram (@BotFather).',
    category: 'Messagerie',
  },
  {
    envVarName: 'AWS_SECRET_ACCESS_KEY',
    label: 'AWS — secret access key',
    description: 'Clé secrète AWS pour le stockage S3.',
    category: 'Stockage',
  },
  {
    envVarName: 'AWS_ACCESS_KEY_ID',
    label: 'AWS — access key ID',
    description: 'Identifiant de clé d’accès AWS.',
    category: 'Stockage',
  },
];

export const WS_SECRET_REGISTRY: SecretKeyDefinition[] = [
  {
    envVarName: 'MONGODB_URI',
    label: 'MongoDB — URI',
    description: 'URI de connexion MongoDB complète. Uniquement via .env (requis avant accès à la base).',
    category: 'MongoDB',
    readOnly: true,
  },
  {
    envVarName: 'DB_HOST',
    label: 'MongoDB — hôte',
    description: 'Hôte MongoDB Atlas (composant URI). Uniquement via .env.',
    category: 'MongoDB',
    readOnly: true,
  },
  {
    envVarName: 'DB_USERNAME',
    label: 'MongoDB — utilisateur',
    description: 'Utilisateur MongoDB. Uniquement via .env.',
    category: 'MongoDB',
    readOnly: true,
  },
  {
    envVarName: 'DB_PASSWORD',
    label: 'MongoDB — mot de passe',
    description: 'Mot de passe MongoDB. Uniquement via .env.',
    category: 'MongoDB',
    readOnly: true,
  },
  {
    envVarName: 'DB_DATABASE',
    label: 'MongoDB — base',
    description: 'Nom de la base MongoDB. Uniquement via .env.',
    category: 'MongoDB',
    readOnly: true,
  },
  {
    envVarName: 'JWT_SECRET',
    label: 'JWT — secret',
    description: 'Signature des tokens WebSocket. Requis au démarrage si Mongo indisponible.',
    category: 'Authentification',
    bootstrapOnly: true,
  },
  {
    envVarName: 'INTERNAL_NOTIFY_SECRET',
    label: 'Secret interne API ↔ WS',
    description: 'Authentifie les appels internes entre le WS et l’API.',
    category: 'Interne',
  },
  {
    envVarName: 'MQTT_BROKER_PASSWORD',
    label: 'MQTT — mot de passe',
    description: 'Mot de passe du broker MQTT (HiveMQ, etc.).',
    category: 'MQTT',
  },
  {
    envVarName: 'REDIS_PASSWORD',
    label: 'Redis — mot de passe',
    description: 'Mot de passe Redis pour le cache distribué.',
    category: 'Cache',
  },
];

export function getSecretRegistry(
  scope: SecretManagerScope,
): SecretKeyDefinition[] {
  return scope === 'ws' ? WS_SECRET_REGISTRY : API_SECRET_REGISTRY;
}

export function isKnownSecretKey(
  scope: SecretManagerScope,
  envVarName: string,
): boolean {
  return getSecretRegistry(scope).some((k) => k.envVarName === envVarName);
}

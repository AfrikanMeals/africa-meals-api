/**
 * Point d’entrée Firebase Cloud Functions (HTTP).
 * Déployé avec : firebase deploy --only functions
 *
 * La fonction exportée s’appelle `api` → base URL …/api/
 * Le préfixe Nest est vide ici pour éviter …/api/api/…
 * Ex. auth : https://<region>-<project>.cloudfunctions.net/api/auth/login
 * Voir docs/FIREBASE_FUNCTIONS.md et docs/BIRD_CHANNELS.md
 */
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { onRequest } from 'firebase-functions/v2/https';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getExpressServer } from './firebase-bootstrap';

/** Lit APP_REGION même quand le CLI Firebase analyse le code avant d’injecter process.env. */
function readAppRegion(): string {
  const fromEnv = process.env.APP_REGION?.trim();
  if (fromEnv) return fromEnv;

  const root = join(__dirname, '..');
  for (const name of ['.env.wise-eat-ca', '.env.functions']) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (!trimmed.startsWith('APP_REGION=')) continue;
      const value = trimmed.slice('APP_REGION='.length).trim();
      if (value) return value;
    }
  }
  return 'us-east1';
}

/** Secrets Bird — créer via `firebase functions:secrets:set <NAME>` avant deploy. */
const birdAccessKey = defineSecret('BIRD_ACCESS_KEY');
const birdWorkspaceId = defineSecret('BIRD_WORKSPACE_ID');
const birdSmsChannelId = defineSecret('BIRD_SMS_CHANNEL_ID');
const birdWhatsappChannelId = defineSecret('BIRD_WHATSAPP_CHANNEL_ID');

const birdSecrets = [
  birdAccessKey,
  birdWorkspaceId,
  birdSmsChannelId,
  birdWhatsappChannelId,
];

const region = readAppRegion();

setGlobalOptions({
  region,
  // Chaque instance warm garde un pool Mongo (`MONGOOSE_MAX_POOL`) : trop
  // d’instances × pool ≈ limite Atlas M0 (~500 connexions cluster).
  maxInstances: Number(process.env.MAX_INSTANCES || 8),
  secrets: birdSecrets,
});

export const api = onRequest(
  {
    timeoutSeconds: Number(process.env.TIMEOUT_SEC || 120),
    memory:
      (process.env.APP_MEMORY as '256MiB' | '512MiB' | '1GiB' | '2GiB') ||
      '1GiB',
    cors: false,
    secrets: birdSecrets,
  },
  async (req, res) => {
    const server = await getExpressServer();
    server(req, res);
  },
);

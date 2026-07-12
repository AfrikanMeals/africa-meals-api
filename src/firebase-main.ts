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
import { getExpressServer } from './firebase-bootstrap';

/** Région prod Functions — us-east1 (Montréal clients + cohérence URL existante). */
const FUNCTIONS_REGION = 'us-east1' as const;

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

setGlobalOptions({
  region: FUNCTIONS_REGION,
  // Chaque instance warm garde un pool Mongo (`MONGOOSE_MAX_POOL`) : trop
  // d’instances × pool ≈ limite Atlas M0 (~500 connexions cluster).
  maxInstances: Number(process.env.MAX_INSTANCES || 5),
  secrets: birdSecrets,
});

function resolveFunctionsCpu(): number | 'gcf_gen1' {
  const raw = String(process.env.APP_CPU ?? '1').trim();
  if (raw === 'gcf_gen1') return 'gcf_gen1';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export const api = onRequest(
  {
    region: FUNCTIONS_REGION,
    timeoutSeconds: Number(process.env.TIMEOUT_SEC || 120),
    memory:
      (process.env.APP_MEMORY as '256MiB' | '512MiB' | '1GiB' | '2GiB') ||
      '512MiB',
    cpu: resolveFunctionsCpu(),
    cors: false,
    secrets: birdSecrets,
  },
  async (req, res) => {
    const server = await getExpressServer();
    server(req, res);
  },
);

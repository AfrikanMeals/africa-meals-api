/**
 * Point d’entrée Firebase Cloud Functions (HTTP).
 * Déployé avec : firebase deploy --only functions
 *
 * La fonction exportée s’appelle `api` → base URL …/api/
 * Le préfixe Nest est vide ici pour éviter …/api/api/…
 * Ex. auth : https://<region>-<project>.cloudfunctions.net/api/auth/login
 * Voir docs/FIREBASE_FUNCTIONS.md
 */
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { onRequest } from 'firebase-functions/v2/https';
import { getExpressServer } from './firebase-bootstrap';

const region = process.env.FUNCTION_REGION || 'europe-west1';

setGlobalOptions({
  region,
  // Chaque instance warm garde un pool Mongo (`MONGOOSE_MAX_POOL`) : trop
  // d’instances × pool ≈ limite Atlas M0 (~500 connexions cluster).
  maxInstances: Number(process.env.FUNCTION_MAX_INSTANCES || 10),
});

export const api = onRequest(
  {
    timeoutSeconds: Number(process.env.FUNCTION_TIMEOUT_SEC || 120),
    memory:
      (process.env.FUNCTION_MEMORY as '256MiB' | '512MiB' | '1GiB' | '2GiB') ||
      '1GiB',
    cors: false,
  },
  async (req, res) => {
    const server = await getExpressServer();
    server(req, res);
  },
);

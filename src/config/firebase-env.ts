import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { ConfigService } from '@nestjs/config';

/**
 * Cloud Functions / Firebase interdit les clés d'environnement dont le nom commence par
 * FIREBASE_, X_GOOGLE_ ou EXT_ (erreur au `firebase deploy`).
 * Utiliser le préfixe AM_FIREBASE_* (Africa Meals) à la place.
 */
export function getAmFirebaseProjectId(
  config: ConfigService,
): string | undefined {
  return config.get<string>('AM_FIREBASE_PROJECT_ID');
}

export function getAmFirebaseStorageBucket(
  config: ConfigService,
): string | undefined {
  return config.get<string>('AM_FIREBASE_STORAGE_BUCKET');
}

export function getAmFirebaseServiceAccountJson(
  config: ConfigService,
): string | undefined {
  return config.get<string>('AM_FIREBASE_SERVICE_ACCOUNT_JSON');
}

export function getAmFirebaseServiceAccountPath(
  config: ConfigService,
): string | undefined {
  return config.get<string>('AM_FIREBASE_SERVICE_ACCOUNT_PATH');
}

function readServiceAccountFile(pathEnv: string): Record<string, unknown> | null {
  const absolutePath = resolve(process.cwd(), pathEnv.trim());
  try {
    const st = statSync(absolutePath);
    if (!st.isFile()) {
      return null;
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = absolutePath;
    const content = readFileSync(absolutePath, 'utf8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildServiceAccountFromDiscreteEnv(
  config: ConfigService,
): Record<string, unknown> | null {
  const projectId = getAmFirebaseProjectId(config)?.trim();
  const clientEmail = config
    .get<string>('AM_FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL')
    ?.trim();
  const privateKeyRaw = config
    .get<string>('AM_FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY')
    ?.trim();
  if (!projectId || !clientEmail || !privateKeyRaw) {
    return null;
  }

  const account: Record<string, unknown> = {
    type: 'service_account',
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKeyRaw.replace(/\\n/g, '\n'),
  };

  const privateKeyId = config
    .get<string>('AM_FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY_ID')
    ?.trim();
  if (privateKeyId) {
    account.private_key_id = privateKeyId;
  }

  const clientId = config
    .get<string>('AM_FIREBASE_SERVICE_ACCOUNT_CLIENT_ID')
    ?.trim();
  if (clientId) {
    account.client_id = clientId;
  }

  return account;
}

/**
 * Charge le compte de service Firebase depuis (par ordre) :
 * 1. `AM_FIREBASE_SERVICE_ACCOUNT_JSON`
 * 2. champs discrets `AM_FIREBASE_SERVICE_ACCOUNT_*`
 * 3. fichier `AM_FIREBASE_SERVICE_ACCOUNT_PATH` ou `GOOGLE_APPLICATION_CREDENTIALS`
 */
export function loadFirebaseServiceAccount(
  config: ConfigService,
): Record<string, unknown> | null {
  const inline = getAmFirebaseServiceAccountJson(config);
  if (inline?.trim()) {
    return JSON.parse(inline) as Record<string, unknown>;
  }

  const fromDiscreteEnv = buildServiceAccountFromDiscreteEnv(config);
  if (fromDiscreteEnv) {
    return fromDiscreteEnv;
  }

  const pathEnv =
    config.get<string>('GOOGLE_APPLICATION_CREDENTIALS') ||
    getAmFirebaseServiceAccountPath(config);
  if (!pathEnv?.trim()) {
    return null;
  }

  return readServiceAccountFile(pathEnv);
}

export const FIREBASE_SERVICE_ACCOUNT_ENV_HINT =
  'Définissez AM_FIREBASE_SERVICE_ACCOUNT_JSON, AM_FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL + AM_FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY, ou AM_FIREBASE_SERVICE_ACCOUNT_PATH (fichier hors dépôt).';

/**
 * Clé Web Push VAPID (console Firebase → Cloud Messaging → certificats Web).
 * Utilisée côté **client** (admin Next.js `getToken`), pas pour l'envoi serveur FCM.
 */
export function getFcmWebVapidKey(config: ConfigService): string | undefined {
  return (
    config.get<string>('FCM_WEB_VAPID_KEY') ||
    config.get<string>('NEXT_PUBLIC_FCM_VAPID_KEY')
  );
}

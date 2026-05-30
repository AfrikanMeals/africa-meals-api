import { ConfigService } from '@nestjs/config';

/**
 * Cloud Functions / Firebase interdit les clés d’environnement dont le nom commence par
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

/**
 * Clé Web Push VAPID (console Firebase → Cloud Messaging → certificats Web).
 * Utilisée côté **client** (admin Next.js `getToken`), pas pour l’envoi serveur FCM.
 */
export function getFcmWebVapidKey(config: ConfigService): string | undefined {
  return (
    config.get<string>('FCM_WEB_VAPID_KEY') ||
    config.get<string>('NEXT_PUBLIC_FCM_VAPID_KEY')
  );
}

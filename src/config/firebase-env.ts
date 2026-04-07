import { ConfigService } from '@nestjs/config';

/**
 * Cloud Functions / Firebase interdit les clés d’environnement dont le nom commence par
 * FIREBASE_, X_GOOGLE_ ou EXT_ (erreur au `firebase deploy`).
 * Utiliser le préfixe AM_FIREBASE_* (Africa Meals) à la place.
 */
export function getAmFirebaseProjectId(config: ConfigService): string | undefined {
  return config.get<string>('AM_FIREBASE_PROJECT_ID');
}

export function getAmFirebaseStorageBucket(config: ConfigService): string | undefined {
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

import type { ConfigService } from '@nestjs/config';
import type { SecretManagerService } from '@modules/secret-manager/secret-manager.service';

/** Clé Google Maps Platform — géocodage serveur + routing clients (restreindre). */
export async function resolveGoogleMapsApiKey(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const fromDb = await secrets.resolveString('api', 'GOOGLE_MAPS_API_KEY');
  const fromEnv = String(
    config?.get<string>('GOOGLE_MAPS_API_KEY') ??
      process.env.GOOGLE_MAPS_API_KEY ??
      '',
  )
    .trim()
    .replace(/^["']|["']$/g, '');
  return (fromDb || fromEnv).trim();
}

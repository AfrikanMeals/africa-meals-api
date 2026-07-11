import type { ConfigService } from '@nestjs/config';
import type { SecretManagerService } from '@modules/secret-manager/secret-manager.service';

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

/**
 * Clé TomTom (Search + Routing) — exposable aux clients (restreindre domaine/bundle).
 * Priorité : TOMTOM_ROUTING_API_KEY → TOMTOM_GEOCODING_API_KEY → TOMTOM_API_KEY.
 */
export async function resolveTomTomApiKey(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const fromDbRouting = await secrets.resolveString(
    'api',
    'TOMTOM_ROUTING_API_KEY',
  );
  const fromDbGeocode = await secrets.resolveString(
    'api',
    'TOMTOM_GEOCODING_API_KEY',
  );
  const fromDbGeneric = await secrets.resolveString('api', 'TOMTOM_API_KEY');

  const env = (name: string) =>
    stripQuotes(
      String(config?.get<string>(name) ?? process.env[name] ?? ''),
    );

  return (
    stripQuotes(fromDbRouting) ||
    stripQuotes(fromDbGeocode) ||
    stripQuotes(fromDbGeneric) ||
    env('TOMTOM_ROUTING_API_KEY') ||
    env('TOMTOM_GEOCODING_API_KEY') ||
    env('TOMTOM_API_KEY')
  );
}

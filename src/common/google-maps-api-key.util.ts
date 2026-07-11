import type { ConfigService } from '@nestjs/config';
import type { SecretManagerService } from '@modules/secret-manager/secret-manager.service';

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

/**
 * Clé Google Maps Platform — géocodage / Routes serveur (peut être IP-restreinte).
 */
export async function resolveGoogleMapsApiKey(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const fromDb = await secrets.resolveString('api', 'GOOGLE_MAPS_API_KEY');
  const fromEnv = stripQuotes(
    String(
      config?.get<string>('GOOGLE_MAPS_API_KEY') ??
        process.env.GOOGLE_MAPS_API_KEY ??
        '',
    ),
  );
  return stripQuotes(fromDb) || fromEnv;
}

/**
 * Clé Google exposable aux clients (Maps JS / mobile).
 * Ne jamais servir `GOOGLE_MAPS_API_KEY` serveur (souvent IP-only) au navigateur.
 */
export async function resolveGoogleMapsBrowserApiKey(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const fromDbBrowser = await secrets.resolveString(
    'api',
    'GOOGLE_MAPS_BROWSER_API_KEY',
  );
  const fromEnvBrowser = stripQuotes(
    String(
      config?.get<string>('GOOGLE_MAPS_BROWSER_API_KEY') ??
        process.env.GOOGLE_MAPS_BROWSER_API_KEY ??
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
        '',
    ),
  );
  return stripQuotes(fromDbBrowser) || fromEnvBrowser;
}

import type { ConfigService } from '@nestjs/config';
import type { SecretManagerService } from '@modules/secret-manager/secret-manager.service';

/** Clé HERE Routing v8 — exposable aux clients (restreindre domaine/bundle). */
export async function resolveHereApiKey(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const fromDb = await secrets.resolveString('api', 'HERE_API_KEY');
  const fromEnv = String(
    config?.get<string>('HERE_API_KEY') ?? process.env.HERE_API_KEY ?? '',
  )
    .trim()
    .replace(/^["']|["']$/g, '');
  return (fromDb || fromEnv).trim();
}

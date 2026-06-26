import { BadRequestException } from '@nestjs/common';
import type { TriggerMigrationDto } from './dto/trigger-migration.dto';

export function buildMongoUriFromMigrationDto(
  dto: Pick<
    TriggerMigrationDto,
    'uri' | 'host' | 'port' | 'username' | 'password' | 'database' | 'authSource'
  >,
): string {
  const explicit = String(dto.uri ?? '').trim();
  if (explicit) {
    if (
      !explicit.startsWith('mongodb://') &&
      !explicit.startsWith('mongodb+srv://')
    ) {
      throw new BadRequestException('invalid_target_uri');
    }
    return explicit;
  }

  const host = String(dto.host ?? '').trim();
  const database = String(dto.database ?? '').trim();
  if (!host || !database) {
    throw new BadRequestException('migration_target_incomplete');
  }

  const port = dto.port ?? 27017;
  const username = String(dto.username ?? '').trim();
  const password = String(dto.password ?? '');
  const authSource = String(dto.authSource ?? 'admin').trim() || 'admin';

  if (username) {
    const user = encodeURIComponent(username);
    const pass = encodeURIComponent(password);
    return `mongodb://${user}:${pass}@${host}:${port}/${database}?authSource=${encodeURIComponent(authSource)}`;
  }

  return `mongodb://${host}:${port}/${database}`;
}

/** Masque les identifiants pour affichage admin. */
export function summarizeMongoUri(uri: string): string {
  try {
    const parsed = new URL(uri.replace('mongodb+srv://', 'https://').replace('mongodb://', 'http://'));
    const host = parsed.host || 'unknown';
    const db = parsed.pathname.replace(/^\//, '') || 'unknown';
    return `${host}/${db}`;
  } catch {
    return 'mongodb-target';
  }
}

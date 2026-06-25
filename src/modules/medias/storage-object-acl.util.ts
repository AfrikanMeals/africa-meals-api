import { ConfigService } from '@nestjs/config';

/** ACL objet activée pour ce moteur (false = bucket policy / UBLA / proxy médias). */
export function storageObjectAclEnabled(
  config: ConfigService,
  engineEnvKey: 'GCS_PUBLIC_READ' | 'AWS_S3_PUBLIC_READ' | 'MINIO_PUBLIC_READ',
): boolean {
  const global = config.get<string>('STORAGE_OBJECT_ACL')?.trim().toLowerCase();
  if (global === 'false' || global === '0' || global === 'no') {
    return false;
  }
  return config.get<string>(engineEnvKey)?.trim() !== 'false';
}

/** Erreurs courantes quand le bucket interdit les ACL objet (UBLA, Object Ownership, etc.). */
export function isObjectAclUnsupportedError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('does not allow acls') ||
    msg.includes('bucket does not allow acl') ||
    msg.includes('uniform bucket-level access') ||
    msg.includes('cannot update access control') ||
    msg.includes('accesscontrolnotsupported') ||
    (msg.includes('invalidrequest') && msg.includes('acl'))
  );
}

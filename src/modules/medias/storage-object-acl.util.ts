import { ConfigService } from '@nestjs/config';
import type { StorageEngineId } from './storage-engine.types';
import {
  AclEngineEnvKey,
  isObjectAclRequested,
} from './storage-public-access.util';

const ENGINE_BY_ACL_ENV_KEY: Record<AclEngineEnvKey, StorageEngineId> = {
  GCS_PUBLIC_READ: 'gcs',
  AWS_S3_PUBLIC_READ: 's3',
  MINIO_PUBLIC_READ: 'minio',
};

/**
 * ACL objet activée pour ce moteur (false = bucket policy / UBLA / proxy médias).
 *
 * Délègue à `isObjectAclRequested`, source unique des défauts par moteur :
 * GCS (PAP) et S3 (« Block all public access ») sont en opt-in explicite.
 */
export function storageObjectAclEnabled(
  config: ConfigService,
  engineEnvKey: AclEngineEnvKey,
): boolean {
  return isObjectAclRequested(ENGINE_BY_ACL_ENV_KEY[engineEnvKey], (key) =>
    config.get<string>(key),
  );
}

/** Erreurs réseau / endpoint injoignable — ne pas confondre avec ACL refusée. */
export function isStorageConnectionError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNRESET'
  ) {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('ehostunreach') ||
    msg.includes('network') ||
    msg.includes('socket hang up')
  );
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
    // S3 Object Ownership « Bucket owner enforced » (Block all public access).
    msg.includes('accesscontrollistnotsupported') ||
    msg.includes('invalidbucketaclwithobjectownership') ||
    msg.includes('public access prevention') ||
    msg.includes('publicaccessprevention') ||
    (msg.includes('invalidrequest') && msg.includes('acl'))
  );
}

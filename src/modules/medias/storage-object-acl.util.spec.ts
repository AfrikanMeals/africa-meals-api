import {
  isObjectAclUnsupportedError,
  isStorageConnectionError,
  storageObjectAclEnabled,
} from './storage-object-acl.util';
import { ConfigService } from '@nestjs/config';

describe('storage-object-acl.util', () => {
  describe('isStorageConnectionError', () => {
    it('detects ECONNREFUSED by code', () => {
      expect(
        isStorageConnectionError(
          Object.assign(new Error('connect ECONNREFUSED'), {
            code: 'ECONNREFUSED',
          }),
        ),
      ).toBe(true);
    });

    it('detects timeout in message', () => {
      expect(isStorageConnectionError(new Error('network timeout'))).toBe(
        true,
      );
    });

    it('returns false for ACL errors', () => {
      expect(
        isStorageConnectionError(new Error('The bucket does not allow ACLs')),
      ).toBe(false);
    });
  });

  describe('isObjectAclUnsupportedError', () => {
    it('detects S3 ACL-disabled bucket', () => {
      expect(
        isObjectAclUnsupportedError(
          new Error('The bucket does not allow ACLs'),
        ),
      ).toBe(true);
    });

    it('detects GCS uniform bucket-level access', () => {
      expect(
        isObjectAclUnsupportedError(
          new Error(
            'Cannot update access control for an object when uniform bucket-level access is enabled',
          ),
        ),
      ).toBe(true);
    });

    it('detects S3 Object Ownership bucket-owner-enforced', () => {
      expect(
        isObjectAclUnsupportedError(
          new Error(
            'AccessControlListNotSupported: The bucket does not allow ACLs',
          ),
        ),
      ).toBe(true);
      expect(
        isObjectAclUnsupportedError(
          new Error('InvalidBucketAclWithObjectOwnership'),
        ),
      ).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isObjectAclUnsupportedError(new Error('network timeout'))).toBe(
        false,
      );
    });
  });

  describe('storageObjectAclEnabled', () => {
    const config = (values: Record<string, string>) =>
      ({
        get: (key: string) => values[key],
      }) as ConfigService;

    it('respects STORAGE_OBJECT_ACL=false', () => {
      expect(
        storageObjectAclEnabled(
          config({ STORAGE_OBJECT_ACL: 'false', GCS_PUBLIC_READ: 'true' }),
          'GCS_PUBLIC_READ',
        ),
      ).toBe(false);
    });

    it('respects per-engine false', () => {
      expect(
        storageObjectAclEnabled(
          config({ AWS_S3_PUBLIC_READ: 'false' }),
          'AWS_S3_PUBLIC_READ',
        ),
      ).toBe(false);
    });

    it('defaults to enabled when unset for MinIO', () => {
      expect(
        storageObjectAclEnabled(config({}), 'MINIO_PUBLIC_READ'),
      ).toBe(true);
    });

    it('defaults to disabled for S3 (Block all public access)', () => {
      expect(storageObjectAclEnabled(config({}), 'AWS_S3_PUBLIC_READ')).toBe(
        false,
      );
    });

    it('enables the S3 ACL only when explicitly true', () => {
      expect(
        storageObjectAclEnabled(
          config({ AWS_S3_PUBLIC_READ: 'true' }),
          'AWS_S3_PUBLIC_READ',
        ),
      ).toBe(true);
    });

    it('defaults to disabled for GCS (private / PAP)', () => {
      expect(storageObjectAclEnabled(config({}), 'GCS_PUBLIC_READ')).toBe(
        false,
      );
    });

    it('enables GCS ACL only when explicitly true', () => {
      expect(
        storageObjectAclEnabled(
          config({ GCS_PUBLIC_READ: 'true' }),
          'GCS_PUBLIC_READ',
        ),
      ).toBe(true);
    });
  });
});

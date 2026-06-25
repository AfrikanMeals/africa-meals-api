import {
  isObjectAclUnsupportedError,
  storageObjectAclEnabled,
} from './storage-object-acl.util';
import { ConfigService } from '@nestjs/config';

describe('storage-object-acl.util', () => {
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

    it('defaults to enabled when unset', () => {
      expect(
        storageObjectAclEnabled(config({}), 'MINIO_PUBLIC_READ'),
      ).toBe(true);
    });
  });
});

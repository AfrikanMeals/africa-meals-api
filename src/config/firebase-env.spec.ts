import { ConfigService } from '@nestjs/config';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadFirebaseServiceAccount } from './firebase-env';

function mockConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('firebase-env', () => {
  describe('loadFirebaseServiceAccount', () => {
    it('loads inline JSON from AM_FIREBASE_SERVICE_ACCOUNT_JSON', () => {
      const account = {
        type: 'service_account',
        project_id: 'wise-eat-ca',
        client_email: 'svc@wise-eat-ca.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
      };
      const config = mockConfig({
        AM_FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account),
      });
      expect(loadFirebaseServiceAccount(config)).toEqual(account);
    });

    it('builds account from discrete env vars', () => {
      const config = mockConfig({
        AM_FIREBASE_PROJECT_ID: 'wise-eat-ca',
        AM_FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL:
          'svc@wise-eat-ca.iam.gserviceaccount.com',
        AM_FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n',
        AM_FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY_ID: 'key-id',
      });
      expect(loadFirebaseServiceAccount(config)).toEqual({
        type: 'service_account',
        project_id: 'wise-eat-ca',
        client_email: 'svc@wise-eat-ca.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
        private_key_id: 'key-id',
      });
    });

    it('loads account from AM_FIREBASE_SERVICE_ACCOUNT_PATH', () => {
      const dir = mkdtempSync(join(tmpdir(), 'firebase-env-'));
      const filePath = join(dir, 'service-account.json');
      const account = {
        type: 'service_account',
        project_id: 'wise-eat-ca',
        client_email: 'svc@wise-eat-ca.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
      };
      writeFileSync(filePath, JSON.stringify(account));

      const config = mockConfig({
        AM_FIREBASE_SERVICE_ACCOUNT_PATH: filePath,
      });
      expect(loadFirebaseServiceAccount(config)).toEqual(account);
    });

    it('returns null when no credentials are configured', () => {
      expect(loadFirebaseServiceAccount(mockConfig({}))).toBeNull();
    });
  });
});

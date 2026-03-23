import { readFileSync } from 'fs';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applicationDefault, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { resolve } from 'path';
import {
  getAmFirebaseProjectId,
  getAmFirebaseServiceAccountJson,
  getAmFirebaseServiceAccountPath,
  getAmFirebaseStorageBucket,
} from 'src/config/firebase-env';
import { MultipartToJsonPipe } from 'src/pipes/multipart-to-json/multipart-to-json.pipe';

function getCredential(config: ConfigService) {
  const serviceAccountJson = getAmFirebaseServiceAccountJson(config);
  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson) as Record<string, unknown>);
  }
  const pathEnv =
    config.get<string>('GOOGLE_APPLICATION_CREDENTIALS') ||
    getAmFirebaseServiceAccountPath(config);
  if (pathEnv?.trim()) {
    const absolutePath = resolve(process.cwd(), pathEnv.trim());
    const content = readFileSync(absolutePath, 'utf8');
    return cert(JSON.parse(content) as Record<string, unknown>);
  }
  return applicationDefault();
}

@Module({
  providers: [
    MultipartToJsonPipe,
    {
      provide: 'FIREBASE_ADMIN',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const projectId = getAmFirebaseProjectId(config);
        const storageBucket =
          getAmFirebaseStorageBucket(config) ||
          (projectId ? `${projectId}.appspot.com` : '');
        const credential = getCredential(config);
        if (getApps().length === 0) {
          return initializeApp(
            {
              credential,
              ...(storageBucket ? { storageBucket } : {}),
            },
            'africa-meals-api',
          );
        }
        return getApp('africa-meals-api');
      },
    },
    {
      provide: 'FIREBASE_STORAGE_BUCKET',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const projectId = getAmFirebaseProjectId(config);
        return (
          getAmFirebaseStorageBucket(config) ||
          (projectId ? `${projectId}.appspot.com` : '')
        );
      },
    },
  ],
  exports: ['FIREBASE_ADMIN', 'FIREBASE_STORAGE_BUCKET', MultipartToJsonPipe],
})
export class SharedModule {}

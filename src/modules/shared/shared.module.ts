import { readFileSync } from 'fs';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applicationDefault, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { resolve } from 'path';
import { MultipartToJsonPipe } from 'src/pipes/multipart-to-json/multipart-to-json.pipe';

function getCredential(config: ConfigService) {
  const serviceAccountJson = config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson) as Record<string, unknown>);
  }
  const pathEnv =
    config.get<string>('GOOGLE_APPLICATION_CREDENTIALS') ||
    config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');
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
        const storageBucket =
          config.get<string>('FIREBASE_STORAGE_BUCKET') ||
          `${config.get<string>('FIREBASE_PROJECT_ID')}.appspot.com`;
        const credential = getCredential(config);
        if (getApps().length === 0) {
          return initializeApp(
            { credential, storageBucket },
            'africa-meals-api',
          );
        }
        return getApp('africa-meals-api');
      },
    },
    {
      provide: 'FIREBASE_STORAGE_BUCKET',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('FIREBASE_STORAGE_BUCKET') ||
        `${config.get<string>('FIREBASE_PROJECT_ID')}.appspot.com`,
    },
  ],
  exports: ['FIREBASE_ADMIN', 'FIREBASE_STORAGE_BUCKET', MultipartToJsonPipe],
})
export class SharedModule {}

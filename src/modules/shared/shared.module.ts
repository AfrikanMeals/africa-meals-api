import { readFileSync } from 'fs';
import { Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { resolve } from 'path';
import {
  getAmFirebaseProjectId,
  getAmFirebaseServiceAccountJson,
  getAmFirebaseServiceAccountPath,
  getAmFirebaseStorageBucket,
} from 'src/config/firebase-env';
import { MultipartToJsonPipe } from 'src/pipes/multipart-to-json/multipart-to-json.pipe';

const FIREBASE_APP_NAME = 'africa-meals-api';
const firebaseBootstrapLog = new Logger('FirebaseAdmin');

type FirebaseAdminInit = {
  credential: ReturnType<typeof cert> | ReturnType<typeof applicationDefault>;
  projectId: string;
  storageBucket: string;
};

function loadServiceAccountFromConfig(
  config: ConfigService,
): Record<string, unknown> | null {
  const inline = getAmFirebaseServiceAccountJson(config);
  if (inline?.trim()) {
    return JSON.parse(inline) as Record<string, unknown>;
  }
  const pathEnv =
    config.get<string>('GOOGLE_APPLICATION_CREDENTIALS') ||
    getAmFirebaseServiceAccountPath(config);
  if (!pathEnv?.trim()) {
    return null;
  }
  const absolutePath = resolve(process.cwd(), pathEnv.trim());
  process.env.GOOGLE_APPLICATION_CREDENTIALS = absolutePath;
  const content = readFileSync(absolutePath, 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

function resolveFirebaseAdminInit(config: ConfigService): FirebaseAdminInit {
  const sa = loadServiceAccountFromConfig(config);
  const saProjectId = String(sa?.project_id ?? sa?.projectId ?? '').trim();
  const saEmail = String(sa?.client_email ?? sa?.clientEmail ?? '').trim();
  const saKey = String(sa?.private_key ?? sa?.privateKey ?? '').trim();
  if (sa && saProjectId && saEmail && saKey) {
    const projectId =
      saProjectId ||
      getAmFirebaseProjectId(config)?.trim() ||
      '';
    const storageBucket =
      getAmFirebaseStorageBucket(config)?.trim() ||
      (projectId ? `${projectId}.appspot.com` : '');
    return {
      credential: cert(sa as ServiceAccount),
      projectId,
      storageBucket,
    };
  }

  firebaseBootstrapLog.warn(
    'Compte de service Firebase introuvable — repli sur applicationDefault() (FCM peut échouer en local). Définissez GOOGLE_APPLICATION_CREDENTIALS=accounts.json',
  );
  const projectId = getAmFirebaseProjectId(config)?.trim() ?? '';
  return {
    credential: applicationDefault(),
    projectId,
    storageBucket:
      getAmFirebaseStorageBucket(config)?.trim() ||
      (projectId ? `${projectId}.appspot.com` : ''),
  };
}

function getOrCreateFirebaseApp(options: FirebaseAdminInit): App {
  const existing = getApps().find((a) => a.name === FIREBASE_APP_NAME);
  if (existing) {
    return existing;
  }
  const app = initializeApp(
    {
      credential: options.credential,
      projectId: options.projectId || undefined,
      ...(options.storageBucket ? { storageBucket: options.storageBucket } : {}),
    },
    FIREBASE_APP_NAME,
  );
  firebaseBootstrapLog.log(
    `Initialisé (projet=${options.projectId || '—'}, bucket=${options.storageBucket || '—'})`,
  );
  return app;
}

@Module({
  providers: [
    MultipartToJsonPipe,
    {
      provide: 'FIREBASE_ADMIN',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const init = resolveFirebaseAdminInit(config);
        if (!init.projectId) {
          firebaseBootstrapLog.error(
            'AM_FIREBASE_PROJECT_ID ou accounts.json (project_id) requis pour FCM',
          );
        }
        return getOrCreateFirebaseApp(init);
      },
    },
    {
      provide: 'FIREBASE_STORAGE_BUCKET',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const init = resolveFirebaseAdminInit(config);
        return init.storageBucket;
      },
    },
  ],
  exports: ['FIREBASE_ADMIN', 'FIREBASE_STORAGE_BUCKET', MultipartToJsonPipe],
})
export class SharedModule {}

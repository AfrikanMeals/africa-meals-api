import { Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import {
  FIREBASE_SERVICE_ACCOUNT_ENV_HINT,
  getAmFirebaseProjectId,
  getAmFirebaseStorageBucket,
  loadFirebaseServiceAccount,
} from 'src/config/firebase-env';
import { MultipartToJsonPipe } from 'src/pipes/multipart-to-json/multipart-to-json.pipe';

const FIREBASE_APP_NAME = 'africa-meals-api';
const firebaseBootstrapLog = new Logger('FirebaseAdmin');

type FirebaseAdminInit = {
  credential: ReturnType<typeof cert>;
  projectId: string;
  storageBucket: string;
};

function resolveFirebaseAdminInit(
  config: ConfigService,
): FirebaseAdminInit | null {
  const sa = loadFirebaseServiceAccount(config);
  const saProjectId = String(sa?.project_id ?? sa?.projectId ?? '').trim();
  const saEmail = String(sa?.client_email ?? sa?.clientEmail ?? '').trim();
  const saKey = String(sa?.private_key ?? sa?.privateKey ?? '').trim();
  if (sa && saProjectId && saEmail && saKey) {
    const projectId =
      saProjectId || getAmFirebaseProjectId(config)?.trim() || '';
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
    `Firebase Admin indisponible sans compte de service (FCM / Firebase Storage désactivés). ${FIREBASE_SERVICE_ACCOUNT_ENV_HINT}`,
  );
  return null;
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
      ...(options.storageBucket
        ? { storageBucket: options.storageBucket }
        : {}),
    },
    FIREBASE_APP_NAME,
  );
  firebaseBootstrapLog.log(
    `Initialisé (projet=${options.projectId || '—'}, bucket=${
      options.storageBucket || '—'
    })`,
  );
  return app;
}

@Module({
  providers: [
    MultipartToJsonPipe,
    {
      provide: 'FIREBASE_ADMIN',
      inject: [ConfigService],
      useFactory: (config: ConfigService): App | null => {
        const init = resolveFirebaseAdminInit(config);
        if (!init) {
          return null;
        }
        try {
          return getOrCreateFirebaseApp(init);
        } catch (err) {
          firebaseBootstrapLog.warn(
            `Firebase Admin init échoué: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return null;
        }
      },
    },
    {
      provide: 'FIREBASE_STORAGE_BUCKET',
      inject: [ConfigService],
      useFactory: (config: ConfigService): string => {
        const init = resolveFirebaseAdminInit(config);
        if (init?.storageBucket) {
          return init.storageBucket;
        }
        const projectId = getAmFirebaseProjectId(config)?.trim() ?? '';
        return (
          getAmFirebaseStorageBucket(config)?.trim() ||
          (projectId ? `${projectId}.appspot.com` : '')
        );
      },
    },
  ],
  exports: ['FIREBASE_ADMIN', 'FIREBASE_STORAGE_BUCKET', MultipartToJsonPipe],
})
export class SharedModule {}

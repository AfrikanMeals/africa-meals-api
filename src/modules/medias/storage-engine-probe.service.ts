import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { StorageEngineId } from './storage-engine.types';
import { StorageEngineFactory } from './storage-engine.factory';

const VALID_ENGINES: StorageEngineId[] = [
  'firebase',
  'gcs',
  's3',
  'minio',
  'r2',
  'vercelBlob',
];

const PROBE_BYTES = Buffer.from('wise-eat-storage-probe-v1', 'utf8');
const PROBE_CONTENT_TYPE = 'text/plain; charset=utf-8';

export type StorageEngineProbeStep = {
  ok: boolean;
  detail: string;
  durationMs: number;
};

export type StorageEngineProbeResult = {
  ok: boolean;
  message: string;
  engine: StorageEngineId;
  configured: boolean;
  objectPath?: string;
  steps: {
    upload: StorageEngineProbeStep;
    download: StorageEngineProbeStep;
    delete: StorageEngineProbeStep;
  };
};

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function parseEngineId(raw: string): StorageEngineId {
  const id = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!VALID_ENGINES.includes(id as StorageEngineId)) {
    throw new BadRequestException(`storage_engine_probe_invalid:${id}`);
  }
  return id as StorageEngineId;
}

async function streamToBuffer(body: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function step(
  ok: boolean,
  detail: string,
  startedMs: number,
): StorageEngineProbeStep {
  return {
    ok,
    detail,
    durationMs: Math.max(0, Math.round(performance.now() - startedMs)),
  };
}

@Injectable()
export class StorageEngineProbeService {
  constructor(private readonly engineFactory: StorageEngineFactory) {}

  async runProbe(
    user: UserModel,
    engineRaw: string,
  ): Promise<StorageEngineProbeResult> {
    assertAdmin(user);
    const engine = parseEngineId(engineRaw);
    const storageEngine = this.engineFactory.byId(engine);
    const configured = storageEngine.isConfigured();

    const emptyStep = (detail: string): StorageEngineProbeStep => ({
      ok: false,
      detail,
      durationMs: 0,
    });

    if (!configured) {
      return {
        ok: false,
        message: `${engine} : non configuré (variables d'environnement manquantes).`,
        engine,
        configured: false,
        steps: {
          upload: emptyStep('Ignoré — moteur non configuré'),
          download: emptyStep('Ignoré — moteur non configuré'),
          delete: emptyStep('Ignoré — moteur non configuré'),
        },
      };
    }

    const objectPath = `system/storage-probe/${engine}-${Date.now()}.txt`;
    let uploadStep = emptyStep('Non exécuté');
    let downloadStep = emptyStep('Non exécuté');
    let deleteStep = emptyStep('Non exécuté');

    const uploadStarted = performance.now();
    try {
      await storageEngine.upload({
        buffer: PROBE_BYTES,
        path: objectPath,
        contentType: PROBE_CONTENT_TYPE,
        owner: 'storage-probe',
      });
      uploadStep = step(true, 'Fichier test écrit', uploadStarted);
    } catch (err) {
      uploadStep = step(
        false,
        err instanceof Error ? err.message : String(err),
        uploadStarted,
      );
      return this.buildResult(engine, true, objectPath, uploadStep, downloadStep, deleteStep);
    }

    const downloadStarted = performance.now();
    try {
      const stream = await storageEngine.readObject(objectPath);
      const body = await streamToBuffer(stream.body);
      if (!body.equals(PROBE_BYTES)) {
        downloadStep = step(
          false,
          `Contenu incohérent (${body.length} octets)`,
          downloadStarted,
        );
      } else {
        downloadStep = step(
          true,
          `${body.length} octets lus`,
          downloadStarted,
        );
      }
    } catch (err) {
      downloadStep = step(
        false,
        err instanceof Error ? err.message : String(err),
        downloadStarted,
      );
    }

    const deleteStarted = performance.now();
    try {
      await storageEngine.delete(objectPath);
      deleteStep = step(true, 'Fichier test supprimé', deleteStarted);
    } catch (err) {
      deleteStep = step(
        false,
        err instanceof Error ? err.message : String(err),
        deleteStarted,
      );
    }

    return this.buildResult(
      engine,
      true,
      objectPath,
      uploadStep,
      downloadStep,
      deleteStep,
    );
  }

  private buildResult(
    engine: StorageEngineId,
    configured: boolean,
    objectPath: string,
    upload: StorageEngineProbeStep,
    download: StorageEngineProbeStep,
    deleteStep: StorageEngineProbeStep,
  ): StorageEngineProbeResult {
    const ok = upload.ok && download.ok && deleteStep.ok;
    const failed = [
      !upload.ok ? 'upload' : null,
      !download.ok ? 'lecture' : null,
      !deleteStep.ok ? 'suppression' : null,
    ].filter(Boolean);

    return {
      ok,
      message: ok
        ? `${engine} : upload, lecture et suppression OK.`
        : `${engine} : échec (${failed.join(', ')}).`,
      engine,
      configured,
      objectPath,
      steps: {
        upload,
        download,
        delete: deleteStep,
      },
    };
  }
}

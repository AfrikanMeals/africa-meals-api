import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  readBirdWhatsAppConfig,
  type BirdConfig,
} from '@modules/ads/bird-channels.util';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import {
  PlatformChannelSettingsDocument,
  PlatformChannelSettingsModel,
} from '@schemas/platform-channel-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateWhatsappChannelSettingsDto } from './dto/update-whatsapp-channel-settings.dto';

const SETTINGS_KEY = 'default';
const MERGED_ENV_CACHE_MS = 30_000;

export type ChannelCredentialSource = 'database' | 'env' | 'none';

export type ChannelCredentialField = {
  value: string;
  source: ChannelCredentialSource;
  configured: boolean;
  preview: string | null;
};

export type WhatsappChannelSettingsResponse = {
  engine: 'bird';
  accessKey: ChannelCredentialField;
  accessKeyUseDatabase: boolean;
  workspaceId: ChannelCredentialField;
  whatsappChannelId: ChannelCredentialField;
  apiBaseUrl: ChannelCredentialField;
  configured: boolean;
  updatedAt: string | null;
};

function assertAdmin(user: UserModel): void {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function maskSecret(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length <= 8) return '••••••••';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function resolveField(
  dbVal: string | null | undefined,
  envVal: string | undefined,
  options?: { maskPreview?: boolean },
): ChannelCredentialField {
  const db = String(dbVal ?? '').trim();
  const env = String(envVal ?? '').trim();
  const previewFor = (v: string) =>
    options?.maskPreview ? maskSecret(v) : v || null;
  if (db) {
    return {
      value: db,
      source: 'database',
      configured: true,
      preview: previewFor(db),
    };
  }
  if (env) {
    return {
      value: env,
      source: 'env',
      configured: true,
      preview: previewFor(env),
    };
  }
  return { value: '', source: 'none', configured: false, preview: null };
}

@Injectable()
export class PlatformChannelsService {
  private mergedEnvCache: {
    at: number;
    env: NodeJS.ProcessEnv;
  } | null = null;

  constructor(
    @InjectModel(PlatformChannelSettingsModel.name)
    private readonly settingsModel: Model<PlatformChannelSettingsDocument>,
    private readonly secrets: SecretManagerService,
  ) {}

  invalidateCache(): void {
    this.mergedEnvCache = null;
  }

  async getWhatsappSettings(user: UserModel): Promise<WhatsappChannelSettingsResponse> {
    assertAdmin(user);
    return this.buildWhatsappSettingsResponse(await this.ensureSettings());
  }

  async updateWhatsappSettings(
    user: UserModel,
    dto: UpdateWhatsappChannelSettingsDto,
  ): Promise<WhatsappChannelSettingsResponse> {
    assertAdmin(user);
    const patch: Record<string, string | null> = {};

    if (dto.workspaceId !== undefined) {
      patch.birdWhatsappWorkspaceId = dto.workspaceId.trim() || null;
    }
    if (dto.whatsappChannelId !== undefined) {
      patch.birdWhatsappChannelId = dto.whatsappChannelId.trim() || null;
    }
    if (dto.apiBaseUrl !== undefined) {
      patch.birdApiBaseUrl = dto.apiBaseUrl.trim() || null;
    }

    if (Object.keys(patch).length > 0) {
      await this.settingsModel
        .findOneAndUpdate(
          { key: SETTINGS_KEY },
          { $set: patch, $setOnInsert: { key: SETTINGS_KEY } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
    }

    if (dto.accessKey !== undefined || dto.accessKeyUseDatabase !== undefined) {
      const keys: Array<{
        envVarName: string;
        dbEnabled?: boolean;
        value?: string;
      }> = [];
      const keyPayload: {
        envVarName: string;
        dbEnabled?: boolean;
        value?: string;
      } = { envVarName: 'BIRD_ACCESS_KEY' };
      if (dto.accessKeyUseDatabase !== undefined) {
        keyPayload.dbEnabled = dto.accessKeyUseDatabase;
      }
      if (dto.accessKey !== undefined) {
        keyPayload.value = dto.accessKey;
        keyPayload.dbEnabled = dto.accessKeyUseDatabase ?? true;
      }
      keys.push(keyPayload);
      await this.secrets.updateSettings(user, {
        scope: 'api',
        managerEnabled: true,
        keys,
      });
    }

    this.invalidateCache();
    return this.getWhatsappSettings(user);
  }

  async getBirdWhatsAppMergedEnv(): Promise<NodeJS.ProcessEnv> {
    const now = Date.now();
    if (
      this.mergedEnvCache &&
      now - this.mergedEnvCache.at < MERGED_ENV_CACHE_MS
    ) {
      return this.mergedEnvCache.env;
    }

    const doc = await this.ensureSettings();
    const accessKey = await this.secrets.resolveString('api', 'BIRD_ACCESS_KEY');
    const merged: NodeJS.ProcessEnv = { ...process.env };

    if (accessKey.trim()) {
      merged.BIRD_ACCESS_KEY = accessKey.trim();
    }
    const workspaceId =
      String(doc.birdWhatsappWorkspaceId ?? '').trim() ||
      process.env.BIRD_WORKSPACE_ID?.trim() ||
      '';
    if (workspaceId) {
      merged.BIRD_WORKSPACE_ID = workspaceId;
    }
    const channelId =
      String(doc.birdWhatsappChannelId ?? '').trim() ||
      process.env.BIRD_WHATSAPP_CHANNEL_ID?.trim() ||
      process.env.BIRD_WHATSAPP_CHANNEL?.trim() ||
      '';
    if (channelId) {
      merged.BIRD_WHATSAPP_CHANNEL_ID = channelId;
    }
    const apiBase =
      String(doc.birdApiBaseUrl ?? '').trim() ||
      process.env.BIRD_API_BASE_URL?.trim() ||
      '';
    if (apiBase) {
      merged.BIRD_API_BASE_URL = apiBase;
    }

    this.mergedEnvCache = { at: now, env: merged };
    return merged;
  }

  async getBirdWhatsAppConfig(): Promise<BirdConfig | null> {
    const env = await this.getBirdWhatsAppMergedEnv();
    return readBirdWhatsAppConfig(env);
  }

  private async ensureSettings(): Promise<PlatformChannelSettingsDocument> {
    return this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $setOnInsert: { key: SETTINGS_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  private async buildWhatsappSettingsResponse(
    doc: PlatformChannelSettingsDocument,
  ): Promise<WhatsappChannelSettingsResponse> {
    const typed = doc as unknown as { updatedAt?: Date };
    const accessResolved = await this.secrets.resolve('api', 'BIRD_ACCESS_KEY');
    const scopeView = await this.secrets.getScopeView('api');
    const accessKeyEntry = scopeView.keys.find(
      (k) => k.envVarName === 'BIRD_ACCESS_KEY',
    );

    const workspaceId = resolveField(
      doc.birdWhatsappWorkspaceId,
      process.env.BIRD_WORKSPACE_ID,
    );
    const whatsappChannelId = resolveField(
      doc.birdWhatsappChannelId,
      process.env.BIRD_WHATSAPP_CHANNEL_ID ||
        process.env.BIRD_WHATSAPP_CHANNEL,
    );
    const apiBaseUrl = resolveField(
      doc.birdApiBaseUrl,
      process.env.BIRD_API_BASE_URL,
    );

    const accessKey: ChannelCredentialField = {
      value: '',
      source: accessResolved.source,
      configured: Boolean(accessResolved.value),
      preview:
        accessKeyEntry?.valuePreview ??
        maskSecret(accessResolved.value) ??
        accessKeyEntry?.envPreview ??
        null,
    };

    const mergedEnv = await this.getBirdWhatsAppMergedEnv();
    const configured = readBirdWhatsAppConfig(mergedEnv) != null;

    return {
      engine: 'bird',
      accessKey,
      accessKeyUseDatabase: accessKeyEntry?.dbEnabled === true,
      workspaceId,
      whatsappChannelId,
      apiBaseUrl,
      configured,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }
}

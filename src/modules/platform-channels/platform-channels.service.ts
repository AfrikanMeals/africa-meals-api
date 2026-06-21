import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import {
  readBirdEmailConfig,
  readBirdWhatsAppConfig,
  type BirdConfig,
} from '@modules/ads/bird-channels.util';
import {
  readTelegramBotConfig,
  type TelegramBotConfig,
} from '@modules/messaging/telegram-bot.util';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import {
  PlatformChannelSettingsDocument,
  PlatformChannelSettingsModel,
} from '@schemas/platform-channel-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateWhatsappChannelSettingsDto } from './dto/update-whatsapp-channel-settings.dto';
import { UpdateTelegramChannelSettingsDto } from './dto/update-telegram-channel-settings.dto';
import {
  UpdateEmailChannelSettingsDto,
  UpsertPlatformSmtpConfigDto,
} from './dto/email-channel-settings.dto';
import {
  buildEmailEngineOptions,
  EMAIL_ENGINE_ANY,
  normalizeEmailEngine,
  normalizeEmailModuleEngine,
  smtpConfigSecretKey,
  smtpEngineValue,
  type EmailEngineOption,
  type EmailModuleEngineRow,
  type PlatformSmtpConfigView,
} from './email-engine.util';
import {
  EMAIL_APP_MODULES,
  isKnownEmailAppModuleId,
} from './email-module.registry';
import {
  buildEmailEngineAttemptChain,
  listConfiguredConcreteEngines,
} from './email-engine-chain.util';
import type { EmailEngineRuntimeContext, SmtpSendProfile } from './email-send.types';
import type { PlatformSmtpConfigModel } from '@schemas/platform-smtp-config.schema';

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

export type TelegramChannelSettingsResponse = {
  botToken: ChannelCredentialField;
  botTokenUseDatabase: boolean;
  apiBaseUrl: ChannelCredentialField;
  configured: boolean;
  updatedAt: string | null;
};

export type EmailProviderCredentialsResponse = {
  apiKey: ChannelCredentialField;
  apiKeyUseDatabase: boolean;
  configured: boolean;
};

export type EmailBirdCredentialsResponse = {
  accessKey: ChannelCredentialField;
  accessKeyUseDatabase: boolean;
  workspaceId: ChannelCredentialField;
  emailChannelId: ChannelCredentialField;
  apiBaseUrl: ChannelCredentialField;
  configured: boolean;
};

export type EmailEngineCredentialsResponse = {
  resend: EmailProviderCredentialsResponse;
  sendgrid: EmailProviderCredentialsResponse;
  bird: EmailBirdCredentialsResponse;
};

export type EmailChannelSettingsResponse = {
  emailEngine: string;
  engineOptions: EmailEngineOption[];
  smtpConfigs: PlatformSmtpConfigView[];
  credentials: EmailEngineCredentialsResponse;
  moduleEngines: EmailModuleEngineRow[];
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
  private mergedWhatsappEnvCache: {
    at: number;
    env: NodeJS.ProcessEnv;
  } | null = null;
  private mergedTelegramEnvCache: {
    at: number;
    env: NodeJS.ProcessEnv;
  } | null = null;

  constructor(
    @InjectModel(PlatformChannelSettingsModel.name)
    private readonly settingsModel: Model<PlatformChannelSettingsDocument>,
    private readonly secrets: SecretManagerService,
  ) {}

  invalidateCache(): void {
    this.mergedWhatsappEnvCache = null;
    this.mergedTelegramEnvCache = null;
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
      this.mergedWhatsappEnvCache &&
      now - this.mergedWhatsappEnvCache.at < MERGED_ENV_CACHE_MS
    ) {
      return this.mergedWhatsappEnvCache.env;
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

    this.mergedWhatsappEnvCache = { at: now, env: merged };
    return merged;
  }

  async getBirdWhatsAppConfig(): Promise<BirdConfig | null> {
    const env = await this.getBirdWhatsAppMergedEnv();
    return readBirdWhatsAppConfig(env);
  }

  async getTelegramSettings(user: UserModel): Promise<TelegramChannelSettingsResponse> {
    assertAdmin(user);
    return this.buildTelegramSettingsResponse(await this.ensureSettings());
  }

  async updateTelegramSettings(
    user: UserModel,
    dto: UpdateTelegramChannelSettingsDto,
  ): Promise<TelegramChannelSettingsResponse> {
    assertAdmin(user);
    const patch: Record<string, string | null> = {};

    if (dto.apiBaseUrl !== undefined) {
      patch.telegramApiBaseUrl = dto.apiBaseUrl.trim() || null;
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

    if (dto.botToken !== undefined || dto.botTokenUseDatabase !== undefined) {
      const keys: Array<{
        envVarName: string;
        dbEnabled?: boolean;
        value?: string;
      }> = [];
      const keyPayload: {
        envVarName: string;
        dbEnabled?: boolean;
        value?: string;
      } = { envVarName: 'TELEGRAM_BOT_TOKEN' };
      if (dto.botTokenUseDatabase !== undefined) {
        keyPayload.dbEnabled = dto.botTokenUseDatabase;
      }
      if (dto.botToken !== undefined) {
        keyPayload.value = dto.botToken;
        keyPayload.dbEnabled = dto.botTokenUseDatabase ?? true;
      }
      keys.push(keyPayload);
      await this.secrets.updateSettings(user, {
        scope: 'api',
        managerEnabled: true,
        keys,
      });
    }

    this.invalidateCache();
    return this.getTelegramSettings(user);
  }

  async getTelegramMergedEnv(): Promise<NodeJS.ProcessEnv> {
    const now = Date.now();
    if (
      this.mergedTelegramEnvCache &&
      now - this.mergedTelegramEnvCache.at < MERGED_ENV_CACHE_MS
    ) {
      return this.mergedTelegramEnvCache.env;
    }

    const doc = await this.ensureSettings();
    const botToken = await this.secrets.resolveString('api', 'TELEGRAM_BOT_TOKEN');
    const merged: NodeJS.ProcessEnv = { ...process.env };

    if (botToken.trim()) {
      merged.TELEGRAM_BOT_TOKEN = botToken.trim();
    }
    const apiBase =
      String(doc.telegramApiBaseUrl ?? '').trim() ||
      process.env.TELEGRAM_API_BASE_URL?.trim() ||
      '';
    if (apiBase) {
      merged.TELEGRAM_API_BASE_URL = apiBase;
    }

    this.mergedTelegramEnvCache = { at: now, env: merged };
    return merged;
  }

  async getTelegramConfig(): Promise<TelegramBotConfig | null> {
    const env = await this.getTelegramMergedEnv();
    return readTelegramBotConfig(env);
  }

  async getEmailSettings(user: UserModel): Promise<EmailChannelSettingsResponse> {
    assertAdmin(user);
    return this.buildEmailSettingsResponse(await this.ensureSettings());
  }

  async updateEmailSettings(
    user: UserModel,
    dto: UpdateEmailChannelSettingsDto,
  ): Promise<EmailChannelSettingsResponse> {
    assertAdmin(user);
    const hasEngineUpdate = dto.emailEngine !== undefined;
    const hasCredentialUpdate =
      dto.resendApiKey !== undefined ||
      dto.resendApiKeyUseDatabase !== undefined ||
      dto.sendgridApiKey !== undefined ||
      dto.sendgridApiKeyUseDatabase !== undefined ||
      dto.birdAccessKey !== undefined ||
      dto.birdAccessKeyUseDatabase !== undefined ||
      dto.birdWorkspaceId !== undefined ||
      dto.birdEmailChannelId !== undefined ||
      dto.birdApiBaseUrl !== undefined;
    const hasModuleEngineUpdate = dto.moduleEngines !== undefined;

    if (!hasEngineUpdate && !hasCredentialUpdate && !hasModuleEngineUpdate) {
      return this.getEmailSettings(user);
    }

    if (hasEngineUpdate) {
      const doc = await this.ensureSettings();
      const smtpConfigs = doc.smtpConfigs ?? [];
      const normalized = normalizeEmailEngine(dto.emailEngine, smtpConfigs);

      await this.settingsModel
        .findOneAndUpdate(
          { key: SETTINGS_KEY },
          { $set: { emailEngine: normalized }, $setOnInsert: { key: SETTINGS_KEY } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
    }

    if (hasCredentialUpdate) {
      const patch: Record<string, string | null> = {};

      if (dto.birdWorkspaceId !== undefined) {
        patch.birdEmailWorkspaceId = dto.birdWorkspaceId.trim() || null;
      }
      if (dto.birdEmailChannelId !== undefined) {
        patch.birdEmailChannelId = dto.birdEmailChannelId.trim() || null;
      }
      if (dto.birdApiBaseUrl !== undefined) {
        patch.birdApiBaseUrl = dto.birdApiBaseUrl.trim() || null;
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

      const keys: Array<{
        envVarName: string;
        dbEnabled?: boolean;
        value?: string;
      }> = [];

      const pushSecretKey = (
        envVarName: string,
        value: string | undefined,
        useDatabase: boolean | undefined,
      ) => {
        if (value === undefined && useDatabase === undefined) return;
        const keyPayload: {
          envVarName: string;
          dbEnabled?: boolean;
          value?: string;
        } = { envVarName };
        if (useDatabase !== undefined) {
          keyPayload.dbEnabled = useDatabase;
        }
        if (value !== undefined) {
          keyPayload.value = value;
          keyPayload.dbEnabled = useDatabase ?? true;
        }
        keys.push(keyPayload);
      };

      pushSecretKey(
        'RESEND_API_KEY',
        dto.resendApiKey,
        dto.resendApiKeyUseDatabase,
      );
      pushSecretKey(
        'SENDGRID_API_KEY',
        dto.sendgridApiKey,
        dto.sendgridApiKeyUseDatabase,
      );
      pushSecretKey(
        'BIRD_ACCESS_KEY',
        dto.birdAccessKey,
        dto.birdAccessKeyUseDatabase,
      );

      if (keys.length > 0) {
        await this.secrets.updateSettings(user, {
          scope: 'api',
          managerEnabled: true,
          keys,
        });
      }

      this.invalidateCache();
    }

    if (hasModuleEngineUpdate && dto.moduleEngines) {
      const doc = await this.ensureSettings();
      const smtpConfigs = doc.smtpConfigs ?? [];
      const current = doc.emailModuleEngines ?? new Map<string, string>();
      const next = new Map(current);

      for (const [rawId, rawEngine] of Object.entries(dto.moduleEngines)) {
        const moduleId = rawId.trim();
        if (!isKnownEmailAppModuleId(moduleId)) {
          throw new BadRequestException(`unknown_email_module:${moduleId}`);
        }
        const normalized = normalizeEmailModuleEngine(rawEngine, smtpConfigs);
        if (normalized === EMAIL_ENGINE_ANY) {
          next.delete(moduleId);
        } else {
          next.set(moduleId, normalized);
        }
      }

      await this.settingsModel
        .findOneAndUpdate(
          { key: SETTINGS_KEY },
          { $set: { emailModuleEngines: Object.fromEntries(next) } },
        )
        .exec();
    }

    return this.getEmailSettings(user);
  }

  async resolveEmailModuleEngine(moduleId: string): Promise<string> {
    const id = String(moduleId ?? '').trim();
    if (!isKnownEmailAppModuleId(id)) {
      return EMAIL_ENGINE_ANY;
    }
    const doc = await this.ensureSettings();
    const smtpConfigs = doc.smtpConfigs ?? [];
    const map = this.readEmailModuleEngineMap(doc);
    const stored = map.get(id);
    return normalizeEmailModuleEngine(stored, smtpConfigs);
  }

  async getEmailEngineRuntimeContext(): Promise<EmailEngineRuntimeContext> {
    const doc = await this.ensureSettings();
    const smtpConfigs = doc.smtpConfigs ?? [];
    const smtpViews = await this.buildSmtpConfigViews(smtpConfigs);
    const mailerKey = process.env.MAILER_API_KEY?.trim() ?? '';
    const mailerSender = process.env.MAILER_SENDER?.trim() ?? '';
    return {
      globalEngine: normalizeEmailEngine(doc.emailEngine, smtpConfigs),
      defaultSmtpConfigured: await this.isDefaultSmtpConfigured(),
      birdEmailConfigured: await this.isBirdEmailConfigured(),
      resendConfigured: await this.isResendConfigured(),
      sendgridConfigured: await this.isSendgridConfigured(),
      configuredSmtpConfigIds: smtpViews
        .filter((view) => view.configured)
        .map((view) => view.id),
      mailerSendConfigured: Boolean(mailerKey && mailerSender),
    };
  }

  async resolveEmailDispatchChain(
    moduleId?: string | null,
  ): Promise<string[]> {
    const ctx = await this.getEmailEngineRuntimeContext();
    const selected =
      moduleId && isKnownEmailAppModuleId(moduleId)
        ? await this.resolveEmailModuleEngine(moduleId)
        : ctx.globalEngine;
    return buildEmailEngineAttemptChain({ selectedEngine: selected, ctx });
  }

  async readDefaultSmtpSendProfile(): Promise<SmtpSendProfile | null> {
    const user = process.env.SMTP_USER?.trim() ?? '';
    if (!user) return null;
    const passPrimary = await this.secrets.resolveString('api', 'SMTP_APP_PASSWORD');
    const passFallback = await this.secrets.resolveString('api', 'SMTP_PASS');
    const pass = (passPrimary || passFallback).replace(/\s/g, '');
    if (!pass) return null;
    const from = process.env.SMTP_FROM?.trim() || user;
    const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
    const portRaw = process.env.SMTP_PORT?.trim() || '587';
    const port = parseInt(portRaw, 10) || 587;
    const fromDisplayName =
      process.env.APP_NAME?.trim() || 'Wise Eat';
    return { host, port, user, pass, from, fromDisplayName };
  }

  async readPlatformSmtpSendProfile(
    configId: string,
  ): Promise<SmtpSendProfile | null> {
    const id = String(configId ?? '').trim();
    if (!id) return null;
    const doc = await this.ensureSettings();
    const cfg = (doc.smtpConfigs ?? []).find((c) => c.id === id);
    if (!cfg?.host || !cfg.user) return null;
    const pass = (
      await this.secrets.resolveString('api', smtpConfigSecretKey(id))
    ).replace(/\s/g, '');
    if (!pass) return null;
    const from = String(cfg.from ?? '').trim() || cfg.user;
    const fromDisplayName =
      String(cfg.fromName ?? '').trim() ||
      process.env.APP_NAME?.trim() ||
      'Wise Eat';
    return {
      host: cfg.host,
      port: cfg.port ?? 587,
      user: cfg.user,
      pass,
      from,
      fromDisplayName,
      secure: cfg.secure === true,
    };
  }

  async listConfiguredConcreteEmailEngines(): Promise<string[]> {
    const ctx = await this.getEmailEngineRuntimeContext();
    const engines = listConfiguredConcreteEngines(ctx);
    if (ctx.mailerSendConfigured) engines.push('mailersend');
    return engines;
  }

  async createSmtpConfig(
    user: UserModel,
    dto: UpsertPlatformSmtpConfigDto,
  ): Promise<EmailChannelSettingsResponse> {
    assertAdmin(user);
    const label = dto.label.trim();
    const host = dto.host.trim();
    const smtpUser = dto.user.trim();
    if (!label || !host || !smtpUser) {
      throw new BadRequestException('smtp_config_fields_required');
    }
    const appPassword = String(dto.appPassword ?? '').trim();
    if (!appPassword) {
      throw new BadRequestException('smtp_app_password_required');
    }

    const id = randomUUID();
    const entry: PlatformSmtpConfigModel = {
      id,
      label,
      host,
      port: dto.port ?? 587,
      user: smtpUser,
      from: String(dto.from ?? '').trim(),
      fromName: String(dto.fromName ?? '').trim(),
      secure: dto.secure === true,
    };

    await this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $push: { smtpConfigs: entry },
          $setOnInsert: { key: SETTINGS_KEY },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    await this.secrets.updateSettings(user, {
      scope: 'api',
      managerEnabled: true,
      keys: [
        {
          envVarName: smtpConfigSecretKey(id),
          value: appPassword,
          dbEnabled: true,
        },
      ],
    });

    return this.getEmailSettings(user);
  }

  async updateSmtpConfig(
    user: UserModel,
    configId: string,
    dto: UpsertPlatformSmtpConfigDto,
  ): Promise<EmailChannelSettingsResponse> {
    assertAdmin(user);
    const id = String(configId ?? '').trim();
    if (!id) {
      throw new BadRequestException('smtp_config_id_required');
    }

    const doc = await this.ensureSettings();
    const configs = doc.smtpConfigs ?? [];
    const idx = configs.findIndex((c) => c.id === id);
    if (idx < 0) {
      throw new NotFoundException('smtp_config_not_found');
    }

    const current = configs[idx];
    const patch: PlatformSmtpConfigModel = {
      ...current,
      label: dto.label.trim() || current.label,
      host: dto.host.trim() || current.host,
      port: dto.port ?? current.port,
      user: dto.user.trim() || current.user,
      from: dto.from !== undefined ? dto.from.trim() : current.from,
      fromName: dto.fromName !== undefined ? dto.fromName.trim() : current.fromName,
      secure: dto.secure ?? current.secure,
    };

    configs[idx] = patch;
    await this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: { smtpConfigs: configs } },
      )
      .exec();

    const appPassword = String(dto.appPassword ?? '').trim();
    if (appPassword) {
      await this.secrets.updateSettings(user, {
        scope: 'api',
        managerEnabled: true,
        keys: [
          {
            envVarName: smtpConfigSecretKey(id),
            value: appPassword,
            dbEnabled: true,
          },
        ],
      });
    }

    return this.getEmailSettings(user);
  }

  async deleteSmtpConfig(
    user: UserModel,
    configId: string,
  ): Promise<EmailChannelSettingsResponse> {
    assertAdmin(user);
    const id = String(configId ?? '').trim();
    if (!id) {
      throw new BadRequestException('smtp_config_id_required');
    }

    const doc = await this.ensureSettings();
    const configs = doc.smtpConfigs ?? [];
    if (!configs.some((c) => c.id === id)) {
      throw new NotFoundException('smtp_config_not_found');
    }

    const emailEngine =
      normalizeEmailEngine(doc.emailEngine, configs) === smtpEngineValue(id)
        ? 'auto'
        : normalizeEmailEngine(
            doc.emailEngine,
            configs.filter((c) => c.id !== id),
          );

    await this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $pull: { smtpConfigs: { id } },
          $set: { emailEngine },
        },
      )
      .exec();

    await this.secrets.updateSettings(user, {
      scope: 'api',
      removeKeys: [smtpConfigSecretKey(id)],
    });

    return this.getEmailSettings(user);
  }

  private async isDefaultSmtpConfigured(): Promise<boolean> {
    const user = process.env.SMTP_USER?.trim() ?? '';
    if (!user) return false;
    const passPrimary = await this.secrets.resolveString('api', 'SMTP_APP_PASSWORD');
    const passFallback = await this.secrets.resolveString('api', 'SMTP_PASS');
    const pass = (passPrimary || passFallback).replace(/\s/g, '');
    return Boolean(pass);
  }

  private async isBirdEmailConfigured(): Promise<boolean> {
    const env = await this.getBirdEmailMergedEnv();
    return readBirdEmailConfig(env) != null;
  }

  async getBirdEmailMergedEnv(): Promise<NodeJS.ProcessEnv> {
    const doc = await this.ensureSettings();
    const accessKey = await this.secrets.resolveString('api', 'BIRD_ACCESS_KEY');
    const merged: NodeJS.ProcessEnv = { ...process.env };

    if (accessKey.trim()) {
      merged.BIRD_ACCESS_KEY = accessKey.trim();
    }
    const workspaceId =
      String(doc.birdEmailWorkspaceId ?? '').trim() ||
      process.env.BIRD_WORKSPACE_ID?.trim() ||
      '';
    if (workspaceId) {
      merged.BIRD_WORKSPACE_ID = workspaceId;
    }
    const emailChannelId =
      String(doc.birdEmailChannelId ?? '').trim() ||
      process.env.BIRD_EMAIL_CHANNEL_ID?.trim() ||
      process.env.BIRD_EMAIL_CHANNEL?.trim() ||
      '';
    if (emailChannelId) {
      merged.BIRD_EMAIL_CHANNEL_ID = emailChannelId;
    }
    const apiBase =
      String(doc.birdApiBaseUrl ?? '').trim() ||
      process.env.BIRD_API_BASE_URL?.trim() ||
      '';
    if (apiBase) {
      merged.BIRD_API_BASE_URL = apiBase;
    }

    return merged;
  }

  async getBirdEmailConfig(): Promise<BirdConfig | null> {
    const env = await this.getBirdEmailMergedEnv();
    return readBirdEmailConfig(env);
  }

  private async isResendConfigured(): Promise<boolean> {
    const key = await this.secrets.resolveString('api', 'RESEND_API_KEY');
    return Boolean(key.trim());
  }

  private async isSendgridConfigured(): Promise<boolean> {
    const key = await this.secrets.resolveString('api', 'SENDGRID_API_KEY');
    return Boolean(key.trim());
  }

  private async buildSecretCredentialView(envVarName: string): Promise<{
    field: ChannelCredentialField;
    useDatabase: boolean;
  }> {
    const resolved = await this.secrets.resolve('api', envVarName);
    const scopeView = await this.secrets.getScopeView('api');
    const entry = scopeView.keys.find((k) => k.envVarName === envVarName);
    return {
      field: {
        value: '',
        source: resolved.source,
        configured: Boolean(resolved.value),
        preview:
          entry?.valuePreview ??
          maskSecret(resolved.value) ??
          entry?.envPreview ??
          null,
      },
      useDatabase: entry?.dbEnabled === true,
    };
  }

  private async buildEmailEngineCredentialsResponse(
    doc: PlatformChannelSettingsDocument,
  ): Promise<EmailEngineCredentialsResponse> {
    const [resendSecret, sendgridSecret, birdAccessSecret] = await Promise.all([
      this.buildSecretCredentialView('RESEND_API_KEY'),
      this.buildSecretCredentialView('SENDGRID_API_KEY'),
      this.buildSecretCredentialView('BIRD_ACCESS_KEY'),
    ]);

    const workspaceId = resolveField(
      doc.birdEmailWorkspaceId,
      process.env.BIRD_WORKSPACE_ID,
    );
    const emailChannelId = resolveField(
      doc.birdEmailChannelId,
      process.env.BIRD_EMAIL_CHANNEL_ID || process.env.BIRD_EMAIL_CHANNEL,
    );
    const apiBaseUrl = resolveField(
      doc.birdApiBaseUrl,
      process.env.BIRD_API_BASE_URL,
    );

    const mergedEnv = await this.getBirdEmailMergedEnv();
    const birdConfigured = readBirdEmailConfig(mergedEnv) != null;

    return {
      resend: {
        apiKey: resendSecret.field,
        apiKeyUseDatabase: resendSecret.useDatabase,
        configured: resendSecret.field.configured,
      },
      sendgrid: {
        apiKey: sendgridSecret.field,
        apiKeyUseDatabase: sendgridSecret.useDatabase,
        configured: sendgridSecret.field.configured,
      },
      bird: {
        accessKey: birdAccessSecret.field,
        accessKeyUseDatabase: birdAccessSecret.useDatabase,
        workspaceId,
        emailChannelId,
        apiBaseUrl,
        configured: birdConfigured,
      },
    };
  }

  private readEmailModuleEngineMap(
    doc: PlatformChannelSettingsDocument,
  ): Map<string, string> {
    const raw = doc.emailModuleEngines as
      | Map<string, string>
      | Record<string, string>
      | undefined;
    if (!raw) return new Map();
    if (raw instanceof Map) return new Map(raw);
    return new Map(Object.entries(raw));
  }

  private buildEmailModuleEngineRows(
    doc: PlatformChannelSettingsDocument,
  ): EmailModuleEngineRow[] {
    const smtpConfigs = doc.smtpConfigs ?? [];
    const map = this.readEmailModuleEngineMap(doc);
    return EMAIL_APP_MODULES.map((mod) => ({
      moduleId: mod.id,
      label: mod.label,
      hint: mod.hint,
      engine: normalizeEmailModuleEngine(map.get(mod.id), smtpConfigs),
    }));
  }

  private async buildSmtpConfigViews(
    configs: PlatformSmtpConfigModel[],
  ): Promise<PlatformSmtpConfigView[]> {
    const scopeView = await this.secrets.getScopeView('api');
    const views: PlatformSmtpConfigView[] = [];

    for (const cfg of configs) {
      const secretKey = smtpConfigSecretKey(cfg.id);
      const resolved = await this.secrets.resolve('api', secretKey);
      const entry = scopeView.keys.find((k) => k.envVarName === secretKey);
      const password: PlatformSmtpConfigView['password'] = {
        value: '',
        source: resolved.source,
        configured: Boolean(resolved.value),
        preview:
          entry?.valuePreview ??
          maskSecret(resolved.value) ??
          entry?.envPreview ??
          null,
      };
      views.push({
        id: cfg.id,
        label: cfg.label,
        host: cfg.host,
        port: cfg.port ?? 587,
        user: cfg.user,
        from: cfg.from ?? '',
        fromName: cfg.fromName ?? '',
        secure: cfg.secure === true,
        configured: Boolean(cfg.host && cfg.user && password.configured),
        password,
      });
    }

    return views;
  }

  private async buildEmailSettingsResponse(
    doc: PlatformChannelSettingsDocument,
  ): Promise<EmailChannelSettingsResponse> {
    const typed = doc as unknown as { updatedAt?: Date };
    const smtpConfigsRaw = doc.smtpConfigs ?? [];
    const smtpConfigs = await this.buildSmtpConfigViews(smtpConfigsRaw);
    const defaultSmtpConfigured = await this.isDefaultSmtpConfigured();
    const birdEmailConfigured = await this.isBirdEmailConfigured();
    const resendConfigured = await this.isResendConfigured();
    const sendgridConfigured = await this.isSendgridConfigured();
    const emailEngine = normalizeEmailEngine(doc.emailEngine, smtpConfigsRaw);
    const engineOptions = buildEmailEngineOptions({
      defaultSmtpConfigured,
      birdEmailConfigured,
      resendConfigured,
      sendgridConfigured,
      smtpConfigs,
    });
    const credentials = await this.buildEmailEngineCredentialsResponse(doc);
    const moduleEngines = this.buildEmailModuleEngineRows(doc);

    return {
      emailEngine,
      engineOptions,
      smtpConfigs,
      credentials,
      moduleEngines,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
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

  private async buildTelegramSettingsResponse(
    doc: PlatformChannelSettingsDocument,
  ): Promise<TelegramChannelSettingsResponse> {
    const typed = doc as unknown as { updatedAt?: Date };
    const botTokenResolved = await this.secrets.resolve('api', 'TELEGRAM_BOT_TOKEN');
    const scopeView = await this.secrets.getScopeView('api');
    const botTokenEntry = scopeView.keys.find(
      (k) => k.envVarName === 'TELEGRAM_BOT_TOKEN',
    );

    const apiBaseUrl = resolveField(
      doc.telegramApiBaseUrl,
      process.env.TELEGRAM_API_BASE_URL,
    );

    const botToken: ChannelCredentialField = {
      value: '',
      source: botTokenResolved.source,
      configured: Boolean(botTokenResolved.value),
      preview:
        botTokenEntry?.valuePreview ??
        maskSecret(botTokenResolved.value) ??
        botTokenEntry?.envPreview ??
        null,
    };

    const mergedEnv = await this.getTelegramMergedEnv();
    const configured = readTelegramBotConfig(mergedEnv) != null;

    return {
      botToken,
      botTokenUseDatabase: botTokenEntry?.dbEnabled === true,
      apiBaseUrl,
      configured,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }
}

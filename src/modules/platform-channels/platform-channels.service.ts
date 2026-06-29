import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import * as nodemailer from 'nodemailer';
import {
  probeBirdChannelApi,
  readBirdEmailConfig,
  readBirdSmsConfig,
  readBirdWhatsAppConfig,
  type BirdConfig,
} from '@modules/ads/bird-channels.util';
import {
  probeTelegramBotApi,
  readTelegramBotConfig,
  type TelegramBotConfig,
} from '@modules/messaging/telegram-bot.util';
import {
  readTwilioSmsConfig,
} from '@modules/messaging/twilio-sms.util';
import {
  MaintenanceAlertSettingsModel,
  SmsEngineEnum,
} from '@schemas/maintenance-alert-settings.schema';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import {
  PlatformChannelSettingsDocument,
  PlatformChannelSettingsModel,
} from '@schemas/platform-channel-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateWhatsappChannelSettingsDto } from './dto/update-whatsapp-channel-settings.dto';
import { UpdateSmsChannelSettingsDto } from './dto/update-sms-channel-settings.dto';
import { UpdateTelegramChannelSettingsDto } from './dto/update-telegram-channel-settings.dto';
import {
  UpdateEmailChannelSettingsDto,
  UpsertPlatformSmtpConfigDto,
} from './dto/email-channel-settings.dto';
import {
  buildEmailEngineOptions,
  EMAIL_ENGINE_ANY,
  EMAIL_ENGINE_AUTO,
  EMAIL_ENGINE_DEFAULT,
  EMAIL_ENGINE_BIRD,
  EMAIL_ENGINE_RESEND,
  EMAIL_ENGINE_SENDGRID,
  normalizeEmailEngine,
  normalizeEmailModuleEngine,
  smtpConfigSecretKey,
  smtpEngineValue,
  smtpConfigIdFromEngine,
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
import {
  buildSmsEngineOptions,
  normalizeSmsEngine,
  SMS_ENGINE_AUTO,
  SMS_ENGINE_BIRD,
  SMS_ENGINE_TWILIO,
  type SmsEngineOption,
} from './sms-engine.util';
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

export type TwilioSmsCredentialsResponse = {
  accountSid: ChannelCredentialField;
  accountSidUseDatabase: boolean;
  authToken: ChannelCredentialField;
  authTokenUseDatabase: boolean;
  smsFrom: ChannelCredentialField;
  configured: boolean;
};

export type BirdSmsCredentialsResponse = {
  accessKey: ChannelCredentialField;
  accessKeyUseDatabase: boolean;
  workspaceId: ChannelCredentialField;
  smsChannelId: ChannelCredentialField;
  apiBaseUrl: ChannelCredentialField;
  configured: boolean;
};

export type SmsChannelSettingsResponse = {
  smsEngine: string;
  engineOptions: SmsEngineOption[];
  bird: BirdSmsCredentialsResponse;
  twilio: TwilioSmsCredentialsResponse;
  updatedAt: string | null;
};

const MAINTENANCE_ALERT_SETTINGS_KEY = 'default';

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

export type EmailEngineHealthSnapshotRow = {
  engine: string;
  label: string;
  configured: boolean;
  globalActive: boolean;
  healthOk: boolean | null;
  healthDetail: string;
};

export type EmailEnginesHealthSnapshot = {
  globalEngine: string;
  rows: EmailEngineHealthSnapshotRow[];
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
  private mergedSmsEnvCache: {
    at: number;
    env: NodeJS.ProcessEnv;
  } | null = null;

  constructor(
    @InjectModel(PlatformChannelSettingsModel.name)
    private readonly settingsModel: Model<PlatformChannelSettingsDocument>,
    @InjectModel(MaintenanceAlertSettingsModel.name)
    private readonly maintenanceSettingsModel: Model<MaintenanceAlertSettingsModel>,
    private readonly secrets: SecretManagerService,
  ) {}

  invalidateCache(): void {
    this.mergedWhatsappEnvCache = null;
    this.mergedTelegramEnvCache = null;
    this.mergedSmsEnvCache = null;
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

  async probeWhatsappSettings(): Promise<{ ok: boolean; message: string; details?: string }> {
    const config = await this.getBirdWhatsAppConfig();
    if (!config) {
      return {
        ok: false,
        message: 'Bird WhatsApp non configuré.',
      };
    }
    const probe = await probeBirdChannelApi({
      config,
      channelId: config.whatsappChannelId ?? '',
    });
    return {
      ok: probe.ok,
      message: probe.ok
        ? 'Bird WhatsApp configuré et accessible.'
        : 'Bird WhatsApp non accessible.',
      details: probe.error,
    };
  }

  async probeTelegramSettings(): Promise<{ ok: boolean; message: string; details?: string }> {
    const config = await this.getTelegramConfig();
    if (!config) {
      return {
        ok: false,
        message: 'Telegram Bot non configuré.',
      };
    }
    const probe = await probeTelegramBotApi({ config });
    return {
      ok: probe.ok,
      message: probe.ok
        ? 'Telegram Bot API valide.'
        : 'Telegram Bot API non valide.',
      details: probe.error,
    };
  }

  async probeEmailEngine(
    engine: string | null | undefined,
  ): Promise<{ ok: boolean; message: string; details?: string }> {
    const doc = await this.ensureSettings();
    const smtpConfigs = doc.smtpConfigs ?? [];
    const normalized = normalizeEmailEngine(engine, smtpConfigs);

    if (normalized === EMAIL_ENGINE_DEFAULT) {
      return this.probeSmtpProfile(
        await this.readDefaultSmtpSendProfile(),
        'SMTP par défaut',
      );
    }
    if (normalized === EMAIL_ENGINE_BIRD) {
      const config = await this.getBirdEmailConfig();
      if (!config) {
        return { ok: false, message: 'Bird Email non configuré.' };
      }
      const probe = await probeBirdChannelApi({
        config,
        channelId: config.emailChannelId ?? '',
      });
      return {
        ok: probe.ok,
        message: probe.ok ? 'Bird Email API valide.' : 'Bird Email API non valide.',
        details: probe.error,
      };
    }
    if (normalized === EMAIL_ENGINE_RESEND) {
      const key = await this.secrets.resolveString('api', 'RESEND_API_KEY');
      if (!key.trim()) {
        return { ok: false, message: 'Resend non configuré.' };
      }
      return { ok: true, message: 'Resend configuré.' };
    }
    if (normalized === EMAIL_ENGINE_SENDGRID) {
      const apiKey = await this.secrets.resolveString('api', 'SENDGRID_API_KEY');
      if (!apiKey.trim()) {
        return { ok: false, message: 'SendGrid non configuré.' };
      }
      return this.probeSendgridApiKey(apiKey);
    }
    const smtpId = smtpConfigIdFromEngine(normalized);
    if (smtpId) {
      return this.probeSmtpProfile(
        await this.readPlatformSmtpSendProfile(smtpId),
        `SMTP ${smtpId}`,
      );
    }
    if (normalized === EMAIL_ENGINE_AUTO) {
      const defaultSmtp = await this.readDefaultSmtpSendProfile();
      if (defaultSmtp) {
        return this.probeSmtpProfile(defaultSmtp, 'SMTP par défaut');
      }
      if (smtpConfigs.length > 0) {
        const profile = await this.readPlatformSmtpSendProfile(smtpConfigs[0].id);
        return this.probeSmtpProfile(profile, `SMTP ${smtpConfigs[0].label}`);
      }
      return { ok: false, message: 'Aucun SMTP configuré pour Auto.' };
    }
    if (normalized === EMAIL_ENGINE_ANY) {
      const defaultSmtp = await this.readDefaultSmtpSendProfile();
      if (defaultSmtp) {
        return this.probeSmtpProfile(defaultSmtp, 'SMTP par défaut');
      }
      if (smtpConfigs.length > 0) {
        const profile = await this.readPlatformSmtpSendProfile(smtpConfigs[0].id);
        return this.probeSmtpProfile(profile, `SMTP ${smtpConfigs[0].label}`);
      }
      if (await this.isBirdEmailConfigured()) {
        const config = await this.getBirdEmailConfig();
        if (config) {
          const probe = await probeBirdChannelApi({
            config,
            channelId: config.emailChannelId ?? '',
          });
          return {
            ok: probe.ok,
            message: probe.ok ? 'Bird Email API valide.' : 'Bird Email API non valide.',
            details: probe.error,
          };
        }
      }
      if (await this.isSendgridConfigured()) {
        const apiKey = await this.secrets.resolveString('api', 'SENDGRID_API_KEY');
        return this.probeSendgridApiKey(apiKey);
      }
      if (await this.isResendConfigured()) {
        return { ok: true, message: 'Resend configuré.' };
      }
      return { ok: false, message: 'Aucun moteur email configuré pour Any.' };
    }

    return { ok: false, message: `Moteur email inconnu : ${engine}` };
  }

  async getEmailEnginesHealthSnapshot(): Promise<EmailEnginesHealthSnapshot> {
    const doc = await this.ensureSettings();
    const smtpConfigsRaw = doc.smtpConfigs ?? [];
    const smtpConfigs = await this.buildSmtpConfigViews(smtpConfigsRaw);
    const defaultSmtpConfigured = await this.isDefaultSmtpConfigured();
    const birdEmailConfigured = await this.isBirdEmailConfigured();
    const resendConfigured = await this.isResendConfigured();
    const sendgridConfigured = await this.isSendgridConfigured();
    const globalEngine = normalizeEmailEngine(doc.emailEngine, smtpConfigsRaw);
    const ctx = await this.getEmailEngineRuntimeContext();
    const engineOptions = buildEmailEngineOptions({
      defaultSmtpConfigured,
      birdEmailConfigured,
      resendConfigured,
      sendgridConfigured,
      smtpConfigs,
    });

    const rows: EmailEngineHealthSnapshotRow[] = [];

    const routerOptions = engineOptions.filter(
      (opt) =>
        opt.value === EMAIL_ENGINE_ANY || opt.value === EMAIL_ENGINE_AUTO,
    );
    for (const opt of routerOptions) {
      rows.push({
        engine: opt.value,
        label: opt.label,
        configured: opt.configured,
        globalActive: globalEngine === opt.value,
        healthOk: null,
        healthDetail: opt.configured
          ? 'routeur (pas de probe direct)'
          : 'non configuré',
      });
    }

    const concreteOptions = engineOptions.filter(
      (opt) =>
        opt.value !== EMAIL_ENGINE_ANY && opt.value !== EMAIL_ENGINE_AUTO,
    );
    const probed = await Promise.all(
      concreteOptions.map(async (opt) => {
        if (!opt.configured) {
          return {
            opt,
            healthOk: null as boolean | null,
            healthDetail: 'non configuré',
          };
        }
        const probe = await this.probeEmailEngine(opt.value);
        return {
          opt,
          healthOk: probe.ok,
          healthDetail: probe.ok
            ? probe.message.replace(/\.$/, '')
            : probe.details ?? probe.message,
        };
      }),
    );
    for (const row of probed) {
      rows.push({
        engine: row.opt.value,
        label: row.opt.label,
        configured: row.opt.configured,
        globalActive: globalEngine === row.opt.value,
        healthOk: row.healthOk,
        healthDetail: row.healthDetail,
      });
    }

    rows.push({
      engine: 'mailersend-legacy',
      label: 'MailerSend (legacy env)',
      configured: ctx.mailerSendConfigured,
      globalActive: false,
      healthOk: ctx.mailerSendConfigured ? true : null,
      healthDetail: ctx.mailerSendConfigured
        ? 'MAILER_API_KEY + MAILER_SENDER présents (pas de probe API)'
        : 'non configuré',
    });

    return { globalEngine, rows };
  }

  private async probeSmtpProfile(
    profile: SmtpSendProfile | null,
    label: string,
  ): Promise<{ ok: boolean; message: string; details?: string }> {
    if (!profile) {
      return { ok: false, message: `${label} non configuré.` };
    }
    try {
      const transport = nodemailer.createTransport({
        host: profile.host,
        port: profile.port,
        secure: profile.secure ?? false,
        auth: {
          user: profile.user,
          pass: profile.pass,
        },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
      });
      await transport.verify();
      return {
        ok: true,
        message: `${label} configuré et vérifié (${profile.host}:${profile.port}).`, 
      };
    } catch (e) {
      return {
        ok: false,
        message: `${label} non accessible.`,
        details: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async probeSendgridApiKey(
    apiKey: string,
  ): Promise<{ ok: boolean; message: string; details?: string }> {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/user/account', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        signal: AbortSignal.timeout(10000),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        return {
          ok: false,
          message: 'SendGrid non valide.',
          details: data.message ?? `SendGrid HTTP ${res.status}`,
        };
      }
      return { ok: true, message: 'SendGrid configuré et valide.' };
    } catch (e) {
      return {
        ok: false,
        message: 'SendGrid non accessible.',
        details: e instanceof Error ? e.message : String(e),
      };
    }
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

  async getSmsSettings(user: UserModel): Promise<SmsChannelSettingsResponse> {
    assertAdmin(user);
    return this.buildSmsSettingsResponse(await this.ensureSettings());
  }

  async updateSmsSettings(
    user: UserModel,
    dto: UpdateSmsChannelSettingsDto,
  ): Promise<SmsChannelSettingsResponse> {
    assertAdmin(user);
    const patch: Record<string, string | null> = {};

    if (dto.birdWorkspaceId !== undefined) {
      patch.birdSmsWorkspaceId = dto.birdWorkspaceId.trim() || null;
    }
    if (dto.birdSmsChannelId !== undefined) {
      patch.birdSmsChannelId = dto.birdSmsChannelId.trim() || null;
    }
    if (dto.birdApiBaseUrl !== undefined) {
      patch.birdApiBaseUrl = dto.birdApiBaseUrl.trim() || null;
    }
    if (dto.twilioSmsFrom !== undefined) {
      patch.twilioSmsFrom = dto.twilioSmsFrom.trim() || null;
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

    const secretKeys: Array<{
      envVarName: string;
      dbEnabled?: boolean;
      value?: string;
    }> = [];

    if (dto.birdAccessKey !== undefined || dto.birdAccessKeyUseDatabase !== undefined) {
      const keyPayload: {
        envVarName: string;
        dbEnabled?: boolean;
        value?: string;
      } = { envVarName: 'BIRD_ACCESS_KEY' };
      if (dto.birdAccessKeyUseDatabase !== undefined) {
        keyPayload.dbEnabled = dto.birdAccessKeyUseDatabase;
      }
      if (dto.birdAccessKey !== undefined) {
        keyPayload.value = dto.birdAccessKey;
        keyPayload.dbEnabled = dto.birdAccessKeyUseDatabase ?? true;
      }
      secretKeys.push(keyPayload);
    }

    if (
      dto.twilioAccountSid !== undefined ||
      dto.twilioAccountSidUseDatabase !== undefined
    ) {
      const keyPayload: {
        envVarName: string;
        dbEnabled?: boolean;
        value?: string;
      } = { envVarName: 'TWILIO_ACCOUNT_SID' };
      if (dto.twilioAccountSidUseDatabase !== undefined) {
        keyPayload.dbEnabled = dto.twilioAccountSidUseDatabase;
      }
      if (dto.twilioAccountSid !== undefined) {
        keyPayload.value = dto.twilioAccountSid;
        keyPayload.dbEnabled = dto.twilioAccountSidUseDatabase ?? true;
      }
      secretKeys.push(keyPayload);
    }

    if (
      dto.twilioAuthToken !== undefined ||
      dto.twilioAuthTokenUseDatabase !== undefined
    ) {
      const keyPayload: {
        envVarName: string;
        dbEnabled?: boolean;
        value?: string;
      } = { envVarName: 'TWILIO_AUTH_TOKEN' };
      if (dto.twilioAuthTokenUseDatabase !== undefined) {
        keyPayload.dbEnabled = dto.twilioAuthTokenUseDatabase;
      }
      if (dto.twilioAuthToken !== undefined) {
        keyPayload.value = dto.twilioAuthToken;
        keyPayload.dbEnabled = dto.twilioAuthTokenUseDatabase ?? true;
      }
      secretKeys.push(keyPayload);
    }

    if (secretKeys.length > 0) {
      await this.secrets.updateSettings(user, {
        scope: 'api',
        managerEnabled: true,
        keys: secretKeys,
      });
    }

    if (dto.smsEngine !== undefined) {
      await this.maintenanceSettingsModel
        .findOneAndUpdate(
          { key: MAINTENANCE_ALERT_SETTINGS_KEY },
          { $set: { smsEngine: dto.smsEngine } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
    }

    this.invalidateCache();
    return this.getSmsSettings(user);
  }

  async getSmsMergedEnv(): Promise<NodeJS.ProcessEnv> {
    const now = Date.now();
    if (
      this.mergedSmsEnvCache &&
      now - this.mergedSmsEnvCache.at < MERGED_ENV_CACHE_MS
    ) {
      return this.mergedSmsEnvCache.env;
    }

    const doc = await this.ensureSettings();
    const merged: NodeJS.ProcessEnv = { ...process.env };

    const accessKey = await this.secrets.resolveString('api', 'BIRD_ACCESS_KEY');
    if (accessKey.trim()) {
      merged.BIRD_ACCESS_KEY = accessKey.trim();
    }

    const workspaceId =
      String(doc.birdSmsWorkspaceId ?? '').trim() ||
      process.env.BIRD_WORKSPACE_ID?.trim() ||
      '';
    if (workspaceId) {
      merged.BIRD_WORKSPACE_ID = workspaceId;
    }

    const smsChannelId =
      String(doc.birdSmsChannelId ?? '').trim() ||
      process.env.BIRD_SMS_CHANNEL_ID?.trim() ||
      process.env.BIRD_SMS_CHANNEL?.trim() ||
      '';
    if (smsChannelId) {
      merged.BIRD_SMS_CHANNEL_ID = smsChannelId;
    }

    const apiBase =
      String(doc.birdApiBaseUrl ?? '').trim() ||
      process.env.BIRD_API_BASE_URL?.trim() ||
      '';
    if (apiBase) {
      merged.BIRD_API_BASE_URL = apiBase;
    }

    const accountSid = await this.secrets.resolveString('api', 'TWILIO_ACCOUNT_SID');
    if (accountSid.trim()) {
      merged.TWILIO_ACCOUNT_SID = accountSid.trim();
    }

    const authToken = await this.secrets.resolveString('api', 'TWILIO_AUTH_TOKEN');
    if (authToken.trim()) {
      merged.TWILIO_AUTH_TOKEN = authToken.trim();
    }

    const smsFrom =
      String(doc.twilioSmsFrom ?? '').trim() ||
      process.env.TWILIO_SMS_FROM?.trim() ||
      process.env.TWILIO_PHONE_NUMBER?.trim() ||
      '';
    if (smsFrom) {
      merged.TWILIO_SMS_FROM = smsFrom;
      merged.TWILIO_PHONE_NUMBER = smsFrom;
    }

    this.mergedSmsEnvCache = { at: now, env: merged };
    return merged;
  }

  async getBirdSmsConfig(): Promise<BirdConfig | null> {
    const env = await this.getSmsMergedEnv();
    return readBirdSmsConfig(env);
  }

  async probeSmsSettings(
    engine?: string,
  ): Promise<{ ok: boolean; message: string; details?: string }> {
    const normalized = normalizeSmsEngine(engine);
    if (normalized === SMS_ENGINE_TWILIO) {
      return this.probeTwilioSms();
    }
    if (normalized === SMS_ENGINE_BIRD) {
      return this.probeBirdSms();
    }
    if (normalized === SMS_ENGINE_AUTO) {
      const env = await this.getSmsMergedEnv();
      const bird = readBirdSmsConfig(env);
      const twilio = readTwilioSmsConfig(env);
      if (!bird && !twilio) {
        return {
          ok: false,
          message: 'Aucun moteur SMS configuré (Bird ou Twilio).',
        };
      }
      const probes = await Promise.all([
        bird ? this.probeBirdSms() : Promise.resolve(null),
        twilio ? this.probeTwilioSms() : Promise.resolve(null),
      ]);
      const ok = probes.some((p) => p?.ok);
      const details = probes
        .filter(Boolean)
        .map((p) => p!.message)
        .join(' · ');
      return {
        ok,
        message: ok
          ? 'Au moins un moteur SMS est opérationnel.'
          : 'Aucun moteur SMS accessible.',
        details,
      };
    }
    return this.probeBirdSms();
  }

  private async probeBirdSms(): Promise<{
    ok: boolean;
    message: string;
    details?: string;
  }> {
    const config = await this.getBirdSmsConfig();
    if (!config?.smsChannelId) {
      return {
        ok: false,
        message: 'Bird SMS non configuré.',
      };
    }
    const probe = await probeBirdChannelApi({
      config,
      channelId: config.smsChannelId,
    });
    return {
      ok: probe.ok,
      message: probe.ok
        ? 'Bird SMS configuré et accessible.'
        : 'Bird SMS non accessible.',
      details: probe.error,
    };
  }

  private async probeTwilioSms(): Promise<{
    ok: boolean;
    message: string;
    details?: string;
  }> {
    const env = await this.getSmsMergedEnv();
    const config = readTwilioSmsConfig(env);
    if (!config) {
      return { ok: false, message: 'Twilio SMS non configuré.' };
    }
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}.json`;
      const auth = Buffer.from(
        `${config.accountSid}:${config.authToken}`,
      ).toString('base64');
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        return {
          ok: false,
          message: 'Twilio non valide.',
          details: data.message ?? `Twilio HTTP ${res.status}`,
        };
      }
      return { ok: true, message: 'Twilio configuré et valide.' };
    } catch (e) {
      return {
        ok: false,
        message: 'Twilio non accessible.',
        details: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** Moteur SMS global (runtime — sans contrôle admin). */
  async getSmsEngineSetting(): Promise<SmsEngineEnum> {
    const raw = await this.readSmsEngineSetting();
    if (raw === SMS_ENGINE_TWILIO) return SmsEngineEnum.TWILIO;
    if (raw === SMS_ENGINE_AUTO) return SmsEngineEnum.AUTO;
    return SmsEngineEnum.BIRD;
  }

  private async readSmsEngineSetting(): Promise<string> {
    const doc = await this.maintenanceSettingsModel
      .findOne({ key: MAINTENANCE_ALERT_SETTINGS_KEY })
      .select('smsEngine')
      .lean()
      .exec();
    return normalizeSmsEngine(doc?.smsEngine);
  }

  private async buildSmsSettingsResponse(
    doc: PlatformChannelSettingsDocument,
  ): Promise<SmsChannelSettingsResponse> {
    const typed = doc as unknown as { updatedAt?: Date };
    const mergedEnv = await this.getSmsMergedEnv();
    const birdConfigured = readBirdSmsConfig(mergedEnv) != null;
    const twilioConfigured = readTwilioSmsConfig(mergedEnv) != null;
    const smsEngine = await this.readSmsEngineSetting();
    const engineOptions = buildSmsEngineOptions({
      birdConfigured,
      twilioConfigured,
    });

    const scopeView = await this.secrets.getScopeView('api');
    const accessResolved = await this.secrets.resolve('api', 'BIRD_ACCESS_KEY');
    const accessKeyEntry = scopeView.keys.find(
      (k) => k.envVarName === 'BIRD_ACCESS_KEY',
    );
    const sidResolved = await this.secrets.resolve('api', 'TWILIO_ACCOUNT_SID');
    const sidEntry = scopeView.keys.find(
      (k) => k.envVarName === 'TWILIO_ACCOUNT_SID',
    );
    const tokenResolved = await this.secrets.resolve('api', 'TWILIO_AUTH_TOKEN');
    const tokenEntry = scopeView.keys.find(
      (k) => k.envVarName === 'TWILIO_AUTH_TOKEN',
    );

    const workspaceId = resolveField(
      doc.birdSmsWorkspaceId,
      process.env.BIRD_WORKSPACE_ID,
    );
    const smsChannelId = resolveField(
      doc.birdSmsChannelId,
      process.env.BIRD_SMS_CHANNEL_ID || process.env.BIRD_SMS_CHANNEL,
    );
    const apiBaseUrl = resolveField(
      doc.birdApiBaseUrl,
      process.env.BIRD_API_BASE_URL,
    );
    const smsFrom = resolveField(
      doc.twilioSmsFrom,
      process.env.TWILIO_SMS_FROM || process.env.TWILIO_PHONE_NUMBER,
    );

    return {
      smsEngine,
      engineOptions,
      bird: {
        accessKey: {
          value: '',
          source: accessResolved.source,
          configured: Boolean(accessResolved.value),
          preview:
            accessKeyEntry?.valuePreview ??
            maskSecret(accessResolved.value) ??
            accessKeyEntry?.envPreview ??
            null,
        },
        accessKeyUseDatabase: accessKeyEntry?.dbEnabled === true,
        workspaceId,
        smsChannelId,
        apiBaseUrl,
        configured: birdConfigured,
      },
      twilio: {
        accountSid: {
          value: '',
          source: sidResolved.source,
          configured: Boolean(sidResolved.value),
          preview:
            sidEntry?.valuePreview ??
            maskSecret(sidResolved.value) ??
            sidEntry?.envPreview ??
            null,
        },
        accountSidUseDatabase: sidEntry?.dbEnabled === true,
        authToken: {
          value: '',
          source: tokenResolved.source,
          configured: Boolean(tokenResolved.value),
          preview:
            tokenEntry?.valuePreview ??
            maskSecret(tokenResolved.value) ??
            tokenEntry?.envPreview ??
            null,
        },
        authTokenUseDatabase: tokenEntry?.dbEnabled === true,
        smsFrom,
        configured: twilioConfigured,
      },
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }
}

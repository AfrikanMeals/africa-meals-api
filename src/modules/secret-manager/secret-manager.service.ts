import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  SecretManagerScope,
  SecretManagerScopeDocument,
  SecretManagerScopeModel,
} from '@schemas/secret-manager.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateSecretManagerDto, ENV_VAR_NAME_PATTERN } from './dto/update-secret-manager.dto';
import {
  getSecretRegistry,
  isKnownSecretKey,
  isMongoDbSecretKey,
  SecretKeyDefinition,
} from './secret-manager.registry';

const CACHE_TTL_MS = 5_000;
const CUSTOM_KEYS_CATEGORY = 'Personnalisées';

export type SecretValueSource = 'database' | 'env' | 'none';

export type ResolvedSecret = {
  value: string;
  source: SecretValueSource;
};

export type SecretKeyAdminView = {
  envVarName: string;
  label: string;
  description: string;
  category: string;
  bootstrapOnly?: boolean;
  dbEnabled: boolean;
  /** Valeur effective (source active). */
  valuePreview: string | null;
  /** Aperçu masqué de la variable .env du processus cible. */
  envPreview: string | null;
  /** Aperçu masqué de la valeur stockée en base. */
  dbPreview: string | null;
  activeSource: SecretValueSource;
  envConfigured: boolean;
  dbConfigured: boolean;
  /** Clé ajoutée manuellement (hors registre). */
  custom?: boolean;
  /** false = lecture seule (.env uniquement, ex. MongoDB). */
  editable: boolean;
};

export type SecretManagerEnvSummary = {
  scope: SecretManagerScope;
  /** Libellé du processus dont provient l'aperçu .env. */
  runtimeLabel: string;
  configuredCount: number;
  totalKeys: number;
  /** Pour WS : le service distant a répondu. */
  remoteReachable: boolean;
};

export type SecretManagerScopeView = {
  scope: SecretManagerScope;
  managerEnabled: boolean;
  keys: SecretKeyAdminView[];
  envSummary: SecretManagerEnvSummary;
  updatedAt: string | null;
};

function assertAdmin(user: UserModel) {
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

function envValue(config: ConfigService, envVarName: string): string {
  return config.get<string>(envVarName)?.trim() ?? '';
}

function assertValidEnvVarName(envVarName: string): void {
  const name = envVarName.trim();
  if (!ENV_VAR_NAME_PATTERN.test(name)) {
    throw new BadRequestException('env_var_name_invalid');
  }
}

@Injectable()
export class SecretManagerService {
  private cache = new Map<
    SecretManagerScope,
    { at: number; doc: SecretManagerScopeModel }
  >();

  constructor(
    @InjectModel(SecretManagerScopeModel.name)
    private readonly _scopes: Model<SecretManagerScopeDocument>,
    private readonly _config: ConfigService,
  ) {}

  invalidateCache(scope?: SecretManagerScope): void {
    if (scope) {
      this.cache.delete(scope);
      return;
    }
    this.cache.clear();
  }

  private async _getScopeDoc(
    scope: SecretManagerScope,
    withValues: boolean,
  ): Promise<SecretManagerScopeModel> {
    const now = Date.now();
    if (!withValues) {
      const cached = this.cache.get(scope);
      if (cached && now - cached.at < CACHE_TTL_MS) {
        return cached.doc;
      }
    }

    const query = this._scopes.findOneAndUpdate(
      { scope },
      {
        $setOnInsert: {
          scope,
          managerEnabled: false,
          entries: [],
        },
      },
      { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
    );
    const doc = withValues
      ? await query.select('+entries.value').exec()
      : await query.exec();

    const typed = doc as SecretManagerScopeModel;
    if (!withValues) {
      this.cache.set(scope, { at: now, doc: typed });
    }
    return typed;
  }

  private _entryMap(
    doc: SecretManagerScopeModel,
  ): Map<string, { dbEnabled: boolean; value: string }> {
    const map = new Map<string, { dbEnabled: boolean; value: string }>();
    for (const entry of doc.entries ?? []) {
      map.set(entry.envVarName, {
        dbEnabled: entry.dbEnabled === true,
        value: String(entry.value ?? '').trim(),
      });
    }
    return map;
  }

  private _resolveFromParts(
    managerEnabled: boolean,
    entry: { dbEnabled: boolean; value: string } | undefined,
    envVarName: string,
    envValOverride?: string,
  ): ResolvedSecret {
    const envVal =
      envValOverride !== undefined
        ? envValOverride.trim()
        : envValue(this._config, envVarName);
    if (!managerEnabled) {
      return envVal
        ? { value: envVal, source: 'env' }
        : { value: '', source: 'none' };
    }
    if (!entry?.dbEnabled) {
      return envVal
        ? { value: envVal, source: 'env' }
        : { value: '', source: 'none' };
    }
    if (entry.value) {
      return { value: entry.value, source: 'database' };
    }
    return envVal
      ? { value: envVal, source: 'env' }
      : { value: '', source: 'none' };
  }

  async resolve(
    scope: SecretManagerScope,
    envVarName: string,
  ): Promise<ResolvedSecret> {
    const doc = await this._getScopeDoc(scope, true);
    const entry = this._entryMap(doc).get(envVarName);
    return this._resolveFromParts(doc.managerEnabled === true, entry, envVarName);
  }

  async resolveString(
    scope: SecretManagerScope,
    envVarName: string,
  ): Promise<string> {
    const resolved = await this.resolve(scope, envVarName);
    return resolved.value;
  }

  private _envPreviewRow(
    scope: SecretManagerScope,
    envVarName: string,
    envPreviews: Map<string, { configured: boolean; preview: string | null }>,
    remoteReachable: boolean,
  ): { configured: boolean; preview: string | null; rawForResolve: string } {
    const row = envPreviews.get(envVarName);
    if (row) {
      return {
        configured: row.configured,
        preview: row.preview,
        rawForResolve: row.configured ? row.preview ?? '••••••••' : '',
      };
    }
    if (scope === 'ws' && !remoteReachable) {
      return { configured: false, preview: null, rawForResolve: '' };
    }
    const raw = envValue(this._config, envVarName);
    return {
      configured: Boolean(raw),
      preview: maskSecret(raw),
      rawForResolve: raw,
    };
  }

  private _buildKeyView(
    def: SecretKeyDefinition,
    doc: SecretManagerScopeModel,
    entryMap: Map<string, { dbEnabled: boolean; value: string }>,
    envPreviews: Map<string, { configured: boolean; preview: string | null }>,
    scope: SecretManagerScope,
    remoteReachable: boolean,
  ): SecretKeyAdminView {
    const entry = entryMap.get(def.envVarName);
    const envRow = this._envPreviewRow(
      scope,
      def.envVarName,
      envPreviews,
      remoteReachable,
    );
    const dbVal = entry?.value ?? '';
    const readOnly = def.readOnly === true || isMongoDbSecretKey(def.envVarName);
    const resolved = readOnly
      ? {
          value: envRow.rawForResolve,
          source: envRow.rawForResolve
            ? ('env' as SecretValueSource)
            : ('none' as SecretValueSource),
        }
      : this._resolveFromParts(
          doc.managerEnabled === true,
          entry,
          def.envVarName,
          envRow.rawForResolve,
        );
    const previewSource =
      resolved.source === 'database'
        ? dbVal
        : resolved.source === 'env'
          ? envRow.rawForResolve
          : '';
    return {
      envVarName: def.envVarName,
      label: def.label,
      description: def.description,
      category: def.category,
      bootstrapOnly: def.bootstrapOnly,
      dbEnabled: readOnly ? false : entry?.dbEnabled === true,
      valuePreview: maskSecret(previewSource),
      envPreview: envRow.preview,
      dbPreview: readOnly ? null : maskSecret(dbVal),
      activeSource: resolved.source,
      envConfigured: envRow.configured,
      dbConfigured: readOnly ? false : Boolean(dbVal),
      custom: false,
      editable: !readOnly,
    };
  }

  private _buildCustomKeyView(
    envVarName: string,
    doc: SecretManagerScopeModel,
    entry: { dbEnabled: boolean; value: string },
    envPreviews: Map<string, { configured: boolean; preview: string | null }>,
    scope: SecretManagerScope,
    remoteReachable: boolean,
  ): SecretKeyAdminView {
    const envRow = this._envPreviewRow(
      scope,
      envVarName,
      envPreviews,
      remoteReachable,
    );
    const dbVal = entry.value ?? '';
    const readOnly = isMongoDbSecretKey(envVarName);
    const resolved = readOnly
      ? {
          value: envRow.rawForResolve,
          source: envRow.rawForResolve
            ? ('env' as SecretValueSource)
            : ('none' as SecretValueSource),
        }
      : this._resolveFromParts(
          doc.managerEnabled === true,
          entry,
          envVarName,
          envRow.rawForResolve,
        );
    const previewSource =
      resolved.source === 'database'
        ? dbVal
        : resolved.source === 'env'
          ? envRow.rawForResolve
          : '';
    return {
      envVarName,
      label: envVarName,
      description: 'Clé personnalisée ajoutée manuellement.',
      category: CUSTOM_KEYS_CATEGORY,
      dbEnabled: readOnly ? false : entry.dbEnabled === true,
      valuePreview: maskSecret(previewSource),
      envPreview: envRow.preview,
      dbPreview: readOnly ? null : maskSecret(dbVal),
      activeSource: resolved.source,
      envConfigured: envRow.configured,
      dbConfigured: readOnly ? false : Boolean(dbVal),
      custom: true,
      editable: !readOnly,
    };
  }

  private async _fetchWsEnvPreviews(
    keys: string[],
  ): Promise<{
    previews: Map<string, { configured: boolean; preview: string | null }>;
    reachable: boolean;
  }> {
    const empty = {
      previews: new Map<string, { configured: boolean; preview: string | null }>(),
      reachable: false,
    };
    if (!keys.length) return empty;

    const raw = this._config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim();
    const secret = await this.resolveString('api', 'INTERNAL_NOTIFY_SECRET');
    if (!raw || !secret) return empty;

    const base = raw.replace(/\/+$/, '');
    const url = base.endsWith('/api')
      ? `${base}/internal/secret-manager/env-preview`
      : `${base}/api/internal/secret-manager/env-preview`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret,
        },
        body: JSON.stringify({ keys }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return empty;
      const data = (await response.json()) as {
        values?: Record<
          string,
          { configured?: boolean; preview?: string | null }
        >;
      };
      const previews = new Map<
        string,
        { configured: boolean; preview: string | null }
      >();
      for (const key of keys) {
        const row = data.values?.[key];
        if (!row) continue;
        previews.set(key, {
          configured: row.configured === true,
          preview:
            typeof row.preview === 'string' || row.preview === null
              ? row.preview
              : null,
        });
      }
      return { previews, reachable: true };
    } catch {
      return empty;
    }
  }

  private async _loadEnvPreviewsForScope(
    scope: SecretManagerScope,
    keyNames: string[],
  ): Promise<{
    previews: Map<string, { configured: boolean; preview: string | null }>;
    reachable: boolean;
  }> {
    if (scope === 'ws') {
      return this._fetchWsEnvPreviews(keyNames);
    }
    const previews = new Map<
      string,
      { configured: boolean; preview: string | null }
    >();
    for (const name of keyNames) {
      const raw = envValue(this._config, name);
      previews.set(name, {
        configured: Boolean(raw),
        preview: maskSecret(raw),
      });
    }
    return { previews, reachable: true };
  }

  private _buildEnvSummary(
    scope: SecretManagerScope,
    keys: SecretKeyAdminView[],
    remoteReachable: boolean,
  ): SecretManagerEnvSummary {
    const appName =
      this._config.get<string>('APP_NAME')?.trim() ||
      this._config.get<string>('MONGODB_APP_NAME')?.trim() ||
      '';
    const runtimeLabel =
      scope === 'api'
        ? `API — ${appName || 'africa-meals-api'} (processus local)`
        : remoteReachable
          ? 'WebSocket — africa-meals-ws (processus distant)'
          : 'WebSocket — africa-meals-ws (processus distant injoignable)';
    return {
      scope,
      runtimeLabel,
      configuredCount: keys.filter((k) => k.envConfigured).length,
      totalKeys: keys.length,
      remoteReachable: scope === 'api' ? true : remoteReachable,
    };
  }

  async getScopeView(scope: SecretManagerScope): Promise<SecretManagerScopeView> {
    const doc = await this._getScopeDoc(scope, true);
    const entryMap = this._entryMap(doc);
    const typed = doc as unknown as { updatedAt?: Date };
    const registryNames = new Set(
      getSecretRegistry(scope).map((def) => def.envVarName),
    );
    const customNames = [...entryMap.keys()].filter(
      (name) => !registryNames.has(name),
    );
    const allKeyNames = [
      ...getSecretRegistry(scope).map((def) => def.envVarName),
      ...customNames,
    ];
    const { previews: envPreviews, reachable } =
      await this._loadEnvPreviewsForScope(scope, allKeyNames);

    const keys = getSecretRegistry(scope).map((def) =>
      this._buildKeyView(def, doc, entryMap, envPreviews, scope, reachable),
    );
    const customKeys = customNames
      .map((envVarName) => {
        const entry = entryMap.get(envVarName);
        if (!entry) return null;
        return this._buildCustomKeyView(
          envVarName,
          doc,
          entry,
          envPreviews,
          scope,
          reachable,
        );
      })
      .filter((k): k is SecretKeyAdminView => k != null)
      .sort((a, b) => a.envVarName.localeCompare(b.envVarName));
    keys.push(...customKeys);

    return {
      scope,
      managerEnabled: doc.managerEnabled === true,
      keys,
      envSummary: this._buildEnvSummary(scope, keys, reachable),
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async getAllScopesView(): Promise<SecretManagerScopeView[]> {
    return Promise.all([this.getScopeView('api'), this.getScopeView('ws')]);
  }

  async updateSettings(
    user: UserModel,
    dto: UpdateSecretManagerDto,
  ): Promise<SecretManagerScopeView> {
    assertAdmin(user);
    const doc = await this._getScopeDoc(dto.scope, true);
    let entries = [...(doc.entries ?? [])].filter(
      (e) => !isMongoDbSecretKey(e.envVarName),
    );

    const upsertEntry = (envVarName: string) => {
      let idx = entries.findIndex((e) => e.envVarName === envVarName);
      if (idx < 0) {
        entries.push({ envVarName, dbEnabled: false, value: '' });
        idx = entries.length - 1;
      }
      return idx;
    };

    if (dto.managerEnabled != null) {
      doc.managerEnabled = dto.managerEnabled;
    }

    if (dto.removeKeys?.length) {
      const removeSet = new Set<string>();
      for (const raw of dto.removeKeys) {
        const name = raw.trim();
        assertValidEnvVarName(name);
        if (isMongoDbSecretKey(name)) {
          throw new BadRequestException(`mongo_key_read_only:${name}`);
        }
        if (isKnownSecretKey(dto.scope, name)) {
          throw new BadRequestException(`cannot_remove_registry_key:${name}`);
        }
        removeSet.add(name);
      }
      entries = entries.filter((e) => !removeSet.has(e.envVarName));
    }

    for (const keyUpdate of dto.keys ?? []) {
      const envVarName = keyUpdate.envVarName.trim();
      assertValidEnvVarName(envVarName);
      if (isMongoDbSecretKey(envVarName)) {
        throw new BadRequestException(`mongo_key_read_only:${envVarName}`);
      }
      const idx = upsertEntry(envVarName);
      if (keyUpdate.dbEnabled != null) {
        entries[idx].dbEnabled = keyUpdate.dbEnabled;
      }
      if (keyUpdate.value != null) {
        const trimmed = keyUpdate.value.trim();
        if (trimmed) {
          entries[idx].value = trimmed;
        }
      }
    }

    await this._scopes
      .findOneAndUpdate(
        { scope: dto.scope },
        {
          $set: {
            managerEnabled: doc.managerEnabled === true,
            entries,
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    this.invalidateCache(dto.scope);
    return this.getScopeView(dto.scope);
  }
}

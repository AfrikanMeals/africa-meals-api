import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { Neo4jService } from '@modules/neo4j/neo4j.service';
import {
  GraphdbSettingsDocument,
  GraphdbSettingsModel,
} from '@schemas/graphdb-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateGraphdbSettingsDto } from './dto/update-graphdb-settings.dto';
import {
  GRAPH_ACTIVATION_MATRIX,
  type GraphActivationRow,
  type GraphDbEffectiveFlags,
  type GraphDbStoredFlags,
  graphFlagsFromEnv,
  resolveEffectiveGraphFlags,
  setGraphRuntimeFlagOverrides,
} from './graph-config.util';

const SETTINGS_KEY = 'default';

export type GraphdbSettingsResponse = {
  neo4jEnabled: boolean;
  recoGraphEnabled: boolean;
  graphSyncEnabled: boolean;
  effective: GraphDbEffectiveFlags;
  env: GraphDbStoredFlags;
  activationMatrix: GraphActivationRow[];
  /** URI configurée (sans secret) — informative. */
  neo4jUriConfigured: boolean;
  /** État driver après sync flags (disabled|up|down). */
  neo4jHealth: 'disabled' | 'up' | 'down';
  updatedAt: string | null;
};

@Injectable()
export class GraphdbSettingsService implements OnModuleInit {
  private readonly logger = new Logger(GraphdbSettingsService.name);

  constructor(
    @InjectModel(GraphdbSettingsModel.name)
    private readonly _settings: Model<GraphdbSettingsDocument>,
    private readonly _storeAccess: StoreAccessService,
    @Optional() private readonly _neo4j?: Neo4jService,
  ) {}

  async onModuleInit(): Promise<void> {
    const doc = await this.ensureSettingsDoc();
    await this.applyRuntimeSettings(doc);
  }

  private async assertAdminSettings(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this._storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  private storedFromDoc(doc: GraphdbSettingsModel): GraphDbStoredFlags {
    return {
      neo4jEnabled: doc.neo4jEnabled === true,
      recoGraphEnabled: doc.recoGraphEnabled === true,
      graphSyncEnabled: doc.graphSyncEnabled === true,
    };
  }

  private async applyRuntimeSettings(
    doc: GraphdbSettingsModel,
  ): Promise<'disabled' | 'up' | 'down'> {
    setGraphRuntimeFlagOverrides(this.storedFromDoc(doc));
    if (!this._neo4j) return 'disabled';
    try {
      const health = await this._neo4j.syncWithRuntimeFlags();
      this.logger.log(
        `GraphDB runtime flags applied — neo4j=${health} reco=${
          doc.recoGraphEnabled === true
        } sync=${doc.graphSyncEnabled === true}`,
      );
      return health;
    } catch (err) {
      this.logger.warn(
        `Neo4j sync after GraphDB flags: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 'down';
    }
  }

  private toResponse(
    doc: GraphdbSettingsModel,
    neo4jHealth: 'disabled' | 'up' | 'down' = 'disabled',
  ): GraphdbSettingsResponse {
    const typed = doc as unknown as { updatedAt?: Date };
    const stored = this.storedFromDoc(doc);
    const env = graphFlagsFromEnv();
    return {
      ...stored,
      effective: resolveEffectiveGraphFlags(stored),
      env,
      activationMatrix: GRAPH_ACTIVATION_MATRIX,
      neo4jUriConfigured: Boolean(
        String(process.env.NEO4J_URI ?? '').trim(),
      ),
      neo4jHealth,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  private async ensureSettingsDoc(): Promise<GraphdbSettingsModel> {
    const env = graphFlagsFromEnv();
    return this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            neo4jEnabled: env.neo4jEnabled,
            recoGraphEnabled: env.recoGraphEnabled,
            graphSyncEnabled: env.graphSyncEnabled,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async getSettings(user: UserModel): Promise<GraphdbSettingsResponse> {
    await this.assertAdminSettings(user);
    const doc = await this.ensureSettingsDoc();
    const health = await this.applyRuntimeSettings(doc);
    return this.toResponse(doc, health);
  }

  async updateSettings(
    user: UserModel,
    dto: UpdateGraphdbSettingsDto,
  ): Promise<GraphdbSettingsResponse> {
    await this.assertAdminSettings(user);
    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            neo4jEnabled: dto.neo4jEnabled === true,
            recoGraphEnabled: dto.recoGraphEnabled === true,
            graphSyncEnabled: dto.graphSyncEnabled === true,
          },
          $setOnInsert: { key: SETTINGS_KEY },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    const health = await this.applyRuntimeSettings(updated);
    return this.toResponse(updated, health);
  }
}

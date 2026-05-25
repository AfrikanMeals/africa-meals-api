import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Connection } from 'mongoose';
import { StoreAccessService } from '../teams/store-access.service';
import {
  DB_CLEARABLE_TABLES,
  DbClearableTableCategory,
  DbClearableTableDef,
  getClearableTable,
  isClearableTableKey,
} from './db-clearable-tables';

export type DbTableListItem = {
  key: string;
  collection: string;
  labelFr: string;
  labelEn: string;
  category: DbClearableTableCategory;
  critical: boolean;
  documentCount: number;
};

export type ClearDbTablesResult = {
  cleared: Array<{ key: string; collection: string; deletedCount: number }>;
};

@Injectable()
export class DbMaintenanceService {
  private readonly logger = new Logger(DbMaintenanceService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  private assertMaintenanceEnabled(): void {
    const raw = this.config.get<string>('ALLOW_DB_MAINTENANCE');
    const normalized = String(raw ?? '').trim().toLowerCase();
    if (normalized === 'false' || normalized === '0') {
      throw new ForbiddenException('db_maintenance_disabled');
    }
    const nodeEnv = String(this.config.get('NODE_ENV') ?? process.env.NODE_ENV ?? '')
      .trim()
      .toLowerCase();
    if (nodeEnv === 'production' && normalized !== 'true' && normalized !== '1') {
      throw new ForbiddenException('db_maintenance_disabled');
    }
  }

  async assertAdminMaintainer(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
    this.assertMaintenanceEnabled();
  }

  async listTables(user: UserModel): Promise<{ tables: DbTableListItem[] }> {
    await this.assertAdminMaintainer(user);
    const db = this.connection.db;
    if (!db) {
      throw new BadRequestException('database_unavailable');
    }

    const tables: DbTableListItem[] = [];
    for (const def of DB_CLEARABLE_TABLES) {
      const documentCount = await this.countCollection(db, def);
      tables.push(this.toListItem(def, documentCount));
    }
    return { tables };
  }

  async clearTables(
    user: UserModel,
    keys: string[],
  ): Promise<ClearDbTablesResult> {
    await this.assertAdminMaintainer(user);

    const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
    if (!unique.length) {
      throw new BadRequestException('no_tables_selected');
    }
    for (const key of unique) {
      if (!isClearableTableKey(key)) {
        throw new BadRequestException(`unknown_table:${key}`);
      }
    }

    const db = this.connection.db;
    if (!db) {
      throw new BadRequestException('database_unavailable');
    }

    const cleared: ClearDbTablesResult['cleared'] = [];
    for (const key of unique) {
      const def = getClearableTable(key)!;
      const res = await db.collection(def.collection).deleteMany({});
      const deletedCount = res.deletedCount ?? 0;
      cleared.push({
        key: def.key,
        collection: def.collection,
        deletedCount,
      });
      this.logger.warn(
        `DB maintenance: ${user.id} cleared ${def.collection} (${deletedCount} doc(s))`,
      );
    }

    return { cleared };
  }

  private toListItem(
    def: DbClearableTableDef,
    documentCount: number,
  ): DbTableListItem {
    return {
      key: def.key,
      collection: def.collection,
      labelFr: def.labelFr,
      labelEn: def.labelEn,
      category: def.category,
      critical: !!def.critical,
      documentCount,
    };
  }

  private async countCollection(
    db: NonNullable<Connection['db']>,
    def: DbClearableTableDef,
  ): Promise<number> {
    try {
      return await db.collection(def.collection).countDocuments();
    } catch {
      return 0;
    }
  }
}

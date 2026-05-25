import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { StoreAccessService } from '../teams/store-access.service';
import { RequestStatsStore } from './request-stats.store';
import { RequestStatsQuery } from './request-stats.types';
import {
  isRequestStatsEnabled,
  requestStatsMaxEntries,
} from './request-stats.util';

@Injectable()
export class RequestStatsService {
  constructor(
    private readonly store: RequestStatsStore,
    private readonly config: ConfigService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async assertViewer(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  isEnabled(): boolean {
    return isRequestStatsEnabled(
      this.config.get<string>('REQUEST_STATS_ENABLED'),
    );
  }

  getMaxEntries(): number {
    return requestStatsMaxEntries(
      this.config.get<string>('REQUEST_STATS_MAX_ENTRIES'),
    );
  }

  async list(user: UserModel, query: RequestStatsQuery) {
    await this.assertViewer(user);
    const all = this.store.query({ ...query, limit: 500 });
    const entries = this.store.query(query);
    return {
      enabled: this.isEnabled(),
      maxEntries: this.getMaxEntries(),
      bufferSize: this.store.size(),
      summary: this.store.summaryFor(all),
      entries,
    };
  }

  async clear(user: UserModel) {
    await this.assertViewer(user);
    this.store.clear();
    return { ok: true };
  }
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DbMaintenanceService } from '@modules/db-maintenance/db-maintenance.service';
import {
  MaintenanceAlertSettingsDocument,
  MaintenanceAlertSettingsModel,
} from '@schemas/maintenance-alert-settings.schema';
import {
  MaintenancePlatformEnum,
  PlatformMaintenanceEntryModel,
} from '@schemas/platform-maintenance.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { TogglePlatformMaintenanceDto } from './dto/toggle-platform-maintenance.dto';
import { PlatformMaintenanceEmailService } from './platform-maintenance-email.service';
import { PlatformMaintenanceSseService } from './platform-maintenance-sse.service';
import { WsPlatformMaintenanceNotifyService } from '@modules/ws-notify/ws-platform-maintenance-notify.service';
import {
  mapPlatformMaintenanceEntry,
  platformMaintenanceField,
  PublicPlatformMaintenanceResponse,
  PlatformMaintenanceStatus,
} from './platform-maintenance.util';

const SETTINGS_KEY = 'default';

export type PlatformMaintenanceSettingsResponse = {
  vendor: PlatformMaintenanceStatus;
  delivery: PlatformMaintenanceStatus;
  customer: PlatformMaintenanceStatus;
};

@Injectable()
export class PlatformMaintenanceService {
  private readonly logger = new Logger(PlatformMaintenanceService.name);

  constructor(
    @InjectModel(MaintenanceAlertSettingsModel.name)
    private readonly settingsModel: Model<MaintenanceAlertSettingsModel>,
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly email: PlatformMaintenanceEmailService,
    private readonly maintenanceSse: PlatformMaintenanceSseService,
    private readonly wsMaintenance: WsPlatformMaintenanceNotifyService,
  ) {}

  async getPublicStatus(): Promise<PublicPlatformMaintenanceResponse> {
    const doc = await this.ensureSettings();
    const response = this.toPublicResponse(doc);
    if (!this.maintenanceSse.lastSnapshot()) {
      this.maintenanceSse.emit(response);
    }
    return response;
  }

  async getAdminStatus(user: UserModel): Promise<PlatformMaintenanceSettingsResponse> {
    await this.dbMaintenance.assertAdminSettingsPermission(user);
    const doc = await this.ensureSettings();
    return this.toAdminResponse(doc);
  }

  async toggle(
    user: UserModel,
    dto: TogglePlatformMaintenanceDto,
  ): Promise<PlatformMaintenanceSettingsResponse & { emailSent: boolean }> {
    await this.dbMaintenance.assertAdminSettingsPermission(user);

    const field = platformMaintenanceField(dto.platform);
    const sendEmail = dto.sendEmailNotification !== false;
    const message = String(dto.message ?? '').trim();
    const now = new Date();
    const actorEmail = String(user.email ?? '').trim();
    const actorId = String(user._id ?? user.id ?? '').trim();

    const entry: PlatformMaintenanceEntryModel = {
      enabled: dto.enabled === true,
      message,
      toggledAt: now,
      toggledByUserId: actorId,
      toggledByEmail: actorEmail,
    };

    const updated = await this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: { [field]: entry } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new BadRequestException('platform_maintenance_update_failed');
    }

    let emailSent = false;
    if (sendEmail) {
      const recipients = (updated.emailRecipients ?? []).filter(Boolean);
      if (recipients.length) {
        emailSent = true;
        await this.email.sendToggleNotification({
          recipients,
          platform: dto.platform,
          enabled: dto.enabled === true,
          message,
          actorEmail,
          toggledAt: now,
        });
      }
    }

    this.logger.log(
      `Platform maintenance ${dto.platform}=${dto.enabled} by ${actorEmail || actorId} email=${emailSent}`,
    );

    const publicSnapshot = {
      ...this.toAdminResponse(updated),
      checkedAt: new Date().toISOString(),
    };
    this.maintenanceSse.emit(publicSnapshot);
    this.wsMaintenance.broadcastStatus(publicSnapshot);

    return {
      ...this.toAdminResponse(updated),
      emailSent,
    };
  }

  private async ensureSettings(): Promise<MaintenanceAlertSettingsDocument> {
    return this.settingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            vendorMaintenance: { enabled: false, message: '' },
            deliveryMaintenance: { enabled: false, message: '' },
            customerMaintenance: { enabled: false, message: '' },
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  private toAdminResponse(
    doc: MaintenanceAlertSettingsDocument,
  ): PlatformMaintenanceSettingsResponse {
    return {
      vendor: mapPlatformMaintenanceEntry(doc.vendorMaintenance),
      delivery: mapPlatformMaintenanceEntry(doc.deliveryMaintenance),
      customer: mapPlatformMaintenanceEntry(doc.customerMaintenance),
    };
  }

  private toPublicResponse(
    doc: MaintenanceAlertSettingsDocument,
  ): PublicPlatformMaintenanceResponse {
    return {
      ...this.toAdminResponse(doc),
      checkedAt: new Date().toISOString(),
    };
  }
}

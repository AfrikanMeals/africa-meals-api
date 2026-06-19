import {
  MaintenancePlatformEnum,
  PlatformMaintenanceEntryModel,
} from '@schemas/platform-maintenance.schema';

export type PlatformMaintenanceStatus = {
  enabled: boolean;
  message: string;
  toggledAt: string | null;
  toggledByEmail: string | null;
};

export type PublicPlatformMaintenanceResponse = {
  vendor: PlatformMaintenanceStatus;
  delivery: PlatformMaintenanceStatus;
  customer: PlatformMaintenanceStatus;
  checkedAt: string;
};

export function mapPlatformMaintenanceEntry(
  entry?: PlatformMaintenanceEntryModel | null,
): PlatformMaintenanceStatus {
  return {
    enabled: entry?.enabled === true,
    message: String(entry?.message ?? '').trim(),
    toggledAt: entry?.toggledAt?.toISOString?.() ?? null,
    toggledByEmail: String(entry?.toggledByEmail ?? '').trim() || null,
  };
}

export function platformMaintenanceField(
  platform: MaintenancePlatformEnum,
): 'vendorMaintenance' | 'deliveryMaintenance' | 'customerMaintenance' {
  switch (platform) {
    case MaintenancePlatformEnum.VENDOR:
      return 'vendorMaintenance';
    case MaintenancePlatformEnum.DELIVERY:
      return 'deliveryMaintenance';
    case MaintenancePlatformEnum.CUSTOMER:
      return 'customerMaintenance';
    default:
      return 'customerMaintenance';
  }
}

export {
  normalizePresetList,
  normalizeRegionCode,
  normalizeRegionShippingEntry as normalizeRegionTipEntry,
  readSettingsByRegion,
  resolveSettingsForRegion as resolveDeliveryTipsForRegion,
  buildGlobalRegionConfig as resolveGlobalDeliveryTips,
  extractTipMapFromSettings as readDeliveryTipByRegion,
} from './platform-shipping-region.util';

export type { RegionShippingConfig as RegionDeliveryTipConfig } from './platform-shipping-region.util';

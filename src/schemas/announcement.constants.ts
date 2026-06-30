/** Audience cible pour une annonce marketing. */
export enum AnnouncementAudienceTypeEnum {
  ALL = 'ALL',
  VENDOR = 'VENDOR',
  COURIER = 'COURIER',
  CUSTOMER = 'CUSTOMER',
  CUSTOM_LIST = 'CUSTOM_LIST',
}

/** Emplacements d’affichage (mobile + admin web). */
export enum AnnouncementPlacementEnum {
  CUSTOMER_HOME_BEFORE_ADS = 'customer_home_before_ads',
  CUSTOMER_CATALOG_AFTER_APP_BAR = 'customer_catalog_after_app_bar',
  CUSTOMER_CART_AFTER_APP_BAR = 'customer_cart_after_app_bar',
  CUSTOMER_CHECKOUT_AFTER_APP_BAR = 'customer_checkout_after_app_bar',
  CUSTOMER_CHAT_AFTER_SEARCH = 'customer_chat_after_search',
  CUSTOMER_PROFILE_AFTER_APP_BAR = 'customer_profile_after_app_bar',
  COURIER_HISTORY_AFTER_APP_BAR = 'courier_history_after_app_bar',
  COURIER_PAYMENT_AFTER_APP_BAR = 'courier_payment_after_app_bar',
  COURIER_MAP_FLOATING_ABOVE_NAV = 'courier_map_floating_above_nav',
  COURIER_CHAT_AFTER_SEARCH = 'courier_chat_after_search',
  COURIER_PROFILE_AFTER_APP_BAR = 'courier_profile_after_app_bar',
  VENDOR_ORDERS_AFTER_SEARCH = 'vendor_orders_after_search',
  VENDOR_FINANCE_AFTER_APP_BAR = 'vendor_finance_after_app_bar',
  VENDOR_DASHBOARD_FLOATING_ABOVE_NAV = 'vendor_dashboard_floating_above_nav',
  VENDOR_CATALOG_AFTER_SEARCH = 'vendor_catalog_after_search',
  VENDOR_PROFILE_AFTER_APP_BAR = 'vendor_profile_after_app_bar',
  ADMIN_SIDEBAR_BOTTOM = 'admin_sidebar_bottom',
  ADMIN_BELOW_HEADER = 'admin_below_header',
}

export const ANNOUNCEMENT_PLACEMENT_VALUES = Object.values(
  AnnouncementPlacementEnum,
);

export const CUSTOMER_PLACEMENTS = [
  AnnouncementPlacementEnum.CUSTOMER_HOME_BEFORE_ADS,
  AnnouncementPlacementEnum.CUSTOMER_CATALOG_AFTER_APP_BAR,
  AnnouncementPlacementEnum.CUSTOMER_CART_AFTER_APP_BAR,
  AnnouncementPlacementEnum.CUSTOMER_CHECKOUT_AFTER_APP_BAR,
  AnnouncementPlacementEnum.CUSTOMER_CHAT_AFTER_SEARCH,
  AnnouncementPlacementEnum.CUSTOMER_PROFILE_AFTER_APP_BAR,
] as const;

export const COURIER_PLACEMENTS = [
  AnnouncementPlacementEnum.COURIER_HISTORY_AFTER_APP_BAR,
  AnnouncementPlacementEnum.COURIER_PAYMENT_AFTER_APP_BAR,
  AnnouncementPlacementEnum.COURIER_MAP_FLOATING_ABOVE_NAV,
  AnnouncementPlacementEnum.COURIER_CHAT_AFTER_SEARCH,
  AnnouncementPlacementEnum.COURIER_PROFILE_AFTER_APP_BAR,
] as const;

export const VENDOR_MOBILE_PLACEMENTS = [
  AnnouncementPlacementEnum.VENDOR_ORDERS_AFTER_SEARCH,
  AnnouncementPlacementEnum.VENDOR_FINANCE_AFTER_APP_BAR,
  AnnouncementPlacementEnum.VENDOR_DASHBOARD_FLOATING_ABOVE_NAV,
  AnnouncementPlacementEnum.VENDOR_CATALOG_AFTER_SEARCH,
  AnnouncementPlacementEnum.VENDOR_PROFILE_AFTER_APP_BAR,
] as const;

export const ADMIN_WEB_PLACEMENTS = [
  AnnouncementPlacementEnum.ADMIN_SIDEBAR_BOTTOM,
  AnnouncementPlacementEnum.ADMIN_BELOW_HEADER,
] as const;

/** Partie impliquée dans un mouvement de pénalité / compensation. */
export enum PenaltyPartyEnum {
  PLATFORM = 'platform',
  VENDOR = 'vendor',
  DELIVERY = 'delivery',
}

/**
 * Sens du flux financier (débiteur → créditeur).
 * Les montants sont toujours positifs en centimes.
 */
export enum PenaltyRouteEnum {
  VENDOR_TO_PLATFORM = 'vendor_to_platform',
  DELIVERY_TO_PLATFORM = 'delivery_to_platform',
  VENDOR_TO_DELIVERY = 'vendor_to_delivery',
  DELIVERY_TO_VENDOR = 'delivery_to_vendor',
  PLATFORM_TO_VENDOR = 'platform_to_vendor',
  PLATFORM_TO_DELIVERY = 'platform_to_delivery',
}

export type PenaltyRouteMeta = {
  from: PenaltyPartyEnum;
  to: PenaltyPartyEnum;
  /** Nécessite `orderId` + transfer vendeur sur la commande. */
  requiresVendorTransfer?: boolean;
  /** Nécessite `orderId` + transfer livraison sur la commande. */
  requiresDeliveryTransfer?: boolean;
  /** Utilise le solde plateforme (transfert Connect sortant). */
  usesPlatformBalance?: boolean;
};

export const PENALTY_ROUTE_META: Record<PenaltyRouteEnum, PenaltyRouteMeta> = {
  [PenaltyRouteEnum.VENDOR_TO_PLATFORM]: {
    from: PenaltyPartyEnum.VENDOR,
    to: PenaltyPartyEnum.PLATFORM,
    requiresVendorTransfer: true,
  },
  [PenaltyRouteEnum.DELIVERY_TO_PLATFORM]: {
    from: PenaltyPartyEnum.DELIVERY,
    to: PenaltyPartyEnum.PLATFORM,
    requiresDeliveryTransfer: true,
  },
  [PenaltyRouteEnum.VENDOR_TO_DELIVERY]: {
    from: PenaltyPartyEnum.VENDOR,
    to: PenaltyPartyEnum.DELIVERY,
    requiresVendorTransfer: true,
    requiresDeliveryTransfer: true,
  },
  [PenaltyRouteEnum.DELIVERY_TO_VENDOR]: {
    from: PenaltyPartyEnum.DELIVERY,
    to: PenaltyPartyEnum.VENDOR,
    requiresDeliveryTransfer: true,
    requiresVendorTransfer: true,
  },
  [PenaltyRouteEnum.PLATFORM_TO_VENDOR]: {
    from: PenaltyPartyEnum.PLATFORM,
    to: PenaltyPartyEnum.VENDOR,
    usesPlatformBalance: true,
  },
  [PenaltyRouteEnum.PLATFORM_TO_DELIVERY]: {
    from: PenaltyPartyEnum.PLATFORM,
    to: PenaltyPartyEnum.DELIVERY,
    usesPlatformBalance: true,
  },
};

export const PENALTY_ROUTE_VALUES = Object.values(PenaltyRouteEnum);

export enum PenaltyStatusEnum {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export enum PenaltyStripeStepKindEnum {
  TRANSFER = 'transfer',
  TRANSFER_REVERSAL = 'transfer_reversal',
}

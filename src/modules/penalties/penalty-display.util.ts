import { PenaltyRouteEnum } from './penalty.types';

const ROUTE_LABELS_FR: Record<PenaltyRouteEnum, string> = {
  [PenaltyRouteEnum.VENDOR_TO_PLATFORM]: 'Vendeur → Plateforme',
  [PenaltyRouteEnum.DELIVERY_TO_PLATFORM]: 'Livreur → Plateforme',
  [PenaltyRouteEnum.VENDOR_TO_DELIVERY]: 'Vendeur → Livreur',
  [PenaltyRouteEnum.DELIVERY_TO_VENDOR]: 'Livreur → Vendeur',
  [PenaltyRouteEnum.PLATFORM_TO_VENDOR]: 'Plateforme → Vendeur',
  [PenaltyRouteEnum.PLATFORM_TO_DELIVERY]: 'Plateforme → Livreur',
};

export function penaltyRouteLabelFr(route: PenaltyRouteEnum): string {
  return ROUTE_LABELS_FR[route] ?? route;
}

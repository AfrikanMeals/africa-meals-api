import { OrderStatusEnum } from '@schemas/order.schema';
import { normalizeRegionCode } from '../platform-shipping-settings/platform-shipping-region.util';

/** Statuts éligibles à la file pending livreur. */
export const DELIVERY_PENDING_ORDER_STATUSES = [
  OrderStatusEnum.CREATED,
  OrderStatusEnum.PAIED,
  OrderStatusEnum.APPROVED,
] as const;

/**
 * Filtre Mongo pour la file pending livreur.
 * Push-down région via `storeRegionCode` (dénormalisé) + repli `taxCountryCode`
 * pour les commandes legacy sans le champ.
 */
export function buildDeliveryPendingOrdersMongoFilter(opts: {
  agentRegionCode?: string | null;
}): Record<string, unknown> {
  const unassigned = {
    $or: [
      { assignedDeliveryUser: { $exists: false } },
      { assignedDeliveryUser: null },
    ],
  };

  const base: Record<string, unknown> = {
    shouldShip: true,
    status: { $in: [...DELIVERY_PENDING_ORDER_STATUSES] },
    ...unassigned,
  };

  const region = normalizeRegionCode(opts.agentRegionCode);
  if (!region) {
    return base;
  }

  return {
    shouldShip: true,
    status: { $in: [...DELIVERY_PENDING_ORDER_STATUSES] },
    $and: [
      unassigned,
      {
        $or: [
          { storeRegionCode: region },
          {
            $and: [
              {
                $or: [
                  { storeRegionCode: { $exists: false } },
                  { storeRegionCode: null },
                  { storeRegionCode: '' },
                ],
              },
              { taxCountryCode: region },
            ],
          },
        ],
      },
    ],
  };
}

import { OrderStatusEnum } from '@schemas/order.schema';
import { normalizeRegionCode } from '../platform-shipping-settings/platform-shipping-region.util';
import { Types } from 'mongoose';

/**
 * Statuts éligibles à la file pending livreur.
 * Uniquement `approved` (= après mark-ready vendeur) — pas created/paied.
 */
export const DELIVERY_PENDING_ORDER_STATUSES = [
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

/**
 * Filtre Mongo historique onglet « Annulées » livreur.
 *
 * Inclut :
 * - commandes annulées / refus vendeur liées au livreur
 *   (`assignedDeliveryUser` ou `deliveryUnassignedFromUser`)
 * - annulations de la file claimable (même région que pending), sans assignee
 */
export function buildDeliveryCancelledHistoryMongoFilter(opts: {
  agentId: Types.ObjectId | string;
  agentRegionCode?: string | null;
}): Record<string, unknown> {
  const agentId =
    opts.agentId instanceof Types.ObjectId
      ? opts.agentId
      : new Types.ObjectId(String(opts.agentId));

  const linkedToAgent = {
    $or: [
      { assignedDeliveryUser: agentId },
      { deliveryUnassignedFromUser: agentId },
    ],
  };

  const unassigned = {
    $or: [
      { assignedDeliveryUser: { $exists: false } },
      { assignedDeliveryUser: null },
    ],
  };

  const region = normalizeRegionCode(opts.agentRegionCode);
  const regionPool: Record<string, unknown>[] = [];
  if (region) {
    regionPool.push({
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
    });
  }

  return {
    shouldShip: true,
    status: OrderStatusEnum.CANCELLED,
    courierAbandonNoPayout: { $ne: true },
    $or: [linkedToAgent, ...regionPool],
  };
}

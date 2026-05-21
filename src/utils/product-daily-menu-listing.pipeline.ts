import { PipelineStage } from 'mongoose';

/**
 * Filtre catalogue mobile : uniquement les plats du menu du jour (jour serveur)
 * avec stock disponible (illimité ou `stockRemaining` > 0).
 *
 * Prérequis : `$store` est un document boutique (pas un tableau) avec `dailyMenuByWeekday`.
 */
export function productDailyMenuListingPipelineStages(): PipelineStage[] {
  const dow = new Date().getDay();
  return [
    {
      $addFields: {
        __todaySlotItems: {
          $let: {
            vars: {
              slot: {
                $first: {
                  $filter: {
                    input: { $ifNull: ['$store.dailyMenuByWeekday', []] },
                    as: 's',
                    cond: { $eq: ['$$s.dayOfWeek', dow] },
                  },
                },
              },
            },
            in: { $ifNull: ['$$slot.items', []] },
          },
        },
      },
    },
    {
      $addFields: {
        __menuItem: {
          $first: {
            $filter: {
              input: '$__todaySlotItems',
              as: 'it',
              cond: {
                $eq: [
                  { $toString: '$$it.productId' },
                  { $toString: '$_id' },
                ],
              },
            },
          },
        },
        __onDailyMenu: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: '$__todaySlotItems',
                  as: 'it',
                  cond: {
                $eq: [
                  { $toString: '$$it.productId' },
                  { $toString: '$_id' },
                ],
              },
                },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        __menuSoldOut: {
          $and: [
            { $ne: ['$__menuItem', null] },
            {
              $eq: [
                { $ifNull: ['$__menuItem.stockUnlimited', true] },
                false,
              ],
            },
            { $lte: [{ $ifNull: ['$__menuItem.stockRemaining', 0] }, 0] },
          ],
        },
      },
    },
    {
      $match: {
        __onDailyMenu: true,
        __menuSoldOut: { $ne: true },
      },
    },
  ];
}

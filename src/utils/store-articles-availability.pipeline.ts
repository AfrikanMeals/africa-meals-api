import { PipelineStage } from 'mongoose';
import {
  mongoEffectiveStoreTimezoneExpr,
  mongoJsDayOfWeekExpr,
} from '@modules/supported-countries/region-timezone.util';

/**
 * Étapes agrégation : exclut les boutiques sans article commandable aujourd’hui
 * (plat menu du jour avec stock, ou boisson `quantite` > 0).
 */
export function storeArticlesAvailabilityPipelineStages(
  regionTimezoneMap: Record<string, string>,
): PipelineStage[] {
  const effectiveTz = mongoEffectiveStoreTimezoneExpr(regionTimezoneMap);
  const jsDay = mongoJsDayOfWeekExpr(effectiveTz);
  return [
    {
      $addFields: {
        __storeEffectiveTz: effectiveTz,
        __storeJsDayOfWeek: jsDay,
      },
    },
    {
      $lookup: {
        from: 'drinks',
        let: { sid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$store', '$$sid'] },
              quantite: { $gt: 0 },
            },
          },
          { $count: 'n' },
        ],
        as: '_drinkCnt',
      },
    },
    {
      $addFields: {
        __orderableDrinksCount: {
          $ifNull: [{ $arrayElemAt: ['$_drinkCnt.n', 0] }, 0],
        },
        __availableFoodCount: {
          $size: {
            $filter: {
              input: {
                $let: {
                  vars: {
                    slot: {
                      $first: {
                        $filter: {
                          input: { $ifNull: ['$dailyMenuByWeekday', []] },
                          as: 's',
                          cond: {
                            $eq: ['$$s.dayOfWeek', '$__storeJsDayOfWeek'],
                          },
                        },
                      },
                    },
                  },
                  in: { $ifNull: ['$$slot.items', []] },
                },
              },
              as: 'it',
              cond: {
                $or: [
                  { $eq: [{ $ifNull: ['$$it.stockUnlimited', true] }, true] },
                  { $gt: [{ $ifNull: ['$$it.stockRemaining', 0] }, 0] },
                ],
              },
            },
          },
        },
      },
    },
    {
      $addFields: {
        __articlesCount: {
          $add: ['$__availableFoodCount', '$__orderableDrinksCount'],
        },
      },
    },
    { $match: { __articlesCount: { $gt: 0 } } },
  ];
}

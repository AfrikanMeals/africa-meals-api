import { PipelineStage } from 'mongoose';
import {
  mongoEffectiveStoreTimezoneExpr,
  mongoJsDayOfWeekExpr,
} from '@modules/supported-countries/region-timezone.util';

/**
 * Calcule `__onDailyMenu`, `__menuItem`, `__menuSoldOut` à partir de
 * `store.dailyMenuByWeekday` (jour local boutique / région).
 *
 * Prérequis : `$store` est un document boutique (pas un tableau).
 */
export function productDailyMenuEnrichmentPipelineStages(
  regionTimezoneMap: Record<string, string>,
): PipelineStage[] {
  const effectiveTz = mongoEffectiveStoreTimezoneExpr(regionTimezoneMap, {
    storeTimezoneField: '$store.timezone',
    regionField: '$store.region',
  });
  const jsDay = mongoJsDayOfWeekExpr(effectiveTz);
  return [
    {
      $addFields: {
        __storeEffectiveTz: effectiveTz,
        __storeJsDayOfWeek: jsDay,
      },
    },
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
                    cond: { $eq: ['$$s.dayOfWeek', '$__storeJsDayOfWeek'] },
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
                $eq: [{ $toString: '$$it.productId' }, { $toString: '$_id' }],
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
              $eq: [{ $ifNull: ['$__menuItem.stockUnlimited', true] }, false],
            },
            { $lte: [{ $ifNull: ['$__menuItem.stockRemaining', 0] }, 0] },
          ],
        },
      },
    },
  ];
}

/** Menu du jour uniquement, avec stock > 0 (ou illimité). */
export function productDailyMenuStrictListingMatchStage(): PipelineStage {
  return {
    $match: {
      __onDailyMenu: true,
      __menuSoldOut: { $ne: true },
    },
  };
}

/**
 * Filtre catalogue mobile : menu du jour uniquement (accueil, recherche, menu boutique, …).
 *
 * Prérequis : `$store` est un document boutique (pas un tableau) avec `dailyMenuByWeekday`.
 */
export function productDailyMenuListingPipelineStages(
  regionTimezoneMap: Record<string, string>,
): PipelineStage[] {
  return [
    ...productDailyMenuEnrichmentPipelineStages(regionTimezoneMap),
    productDailyMenuStrictListingMatchStage(),
  ];
}

/**
 * Repli accueil : menu du jour strict, ou catalogue complet si la boutique n’a
 * aucun plat planifié aujourd’hui (slot vide).
 */
export function productDailyMenuHomeFeedFallbackMatchStage(): PipelineStage {
  return {
    $match: {
      $or: [
        {
          __onDailyMenu: true,
          __menuSoldOut: { $ne: true },
        },
        {
          $expr: {
            $eq: [{ $size: { $ifNull: ['$__todaySlotItems', []] } }, 0],
          },
        },
      ],
    },
  };
}

export function productDailyMenuHomeFeedFallbackPipelineStages(
  regionTimezoneMap: Record<string, string>,
): PipelineStage[] {
  return [
    ...productDailyMenuEnrichmentPipelineStages(regionTimezoneMap),
    productDailyMenuHomeFeedFallbackMatchStage(),
  ];
}

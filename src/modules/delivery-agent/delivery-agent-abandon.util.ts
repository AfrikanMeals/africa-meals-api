import { parseStoreCollectedAt } from './delivery-agent-store-collected.util';

/**
 * Conséquences d’un abandon livreur (score + flags) — logique pure.
 * Après collecte boutique : autorisé, mais pénalité score plus lourde
 * et pénalités/frais admin possibles (pas de blocage API).
 */
export type CourierAbandonConsequences = {
  afterStoreCollect: boolean;
  unassignByCourierInc: number;
  unassignAfterStoreCollectInc: number;
  clearStoreCollected: boolean;
};

/**
 * true si la commande a déjà quitté le restaurant (`storeCollectedAt`).
 */
export function isCourierAbandonAfterStoreCollect(
  storeCollectedAt: Date | string | null | undefined,
): boolean {
  return parseStoreCollectedAt(storeCollectedAt) != null;
}

/**
 * Incréments perf + reset collect pour réassignation.
 * Post-collect : +1 abandon classique ET +1 compteur post-collect (score).
 */
export function courierAbandonConsequences(
  storeCollectedAt: Date | string | null | undefined,
): CourierAbandonConsequences {
  const afterStoreCollect = isCourierAbandonAfterStoreCollect(storeCollectedAt);
  return {
    afterStoreCollect,
    unassignByCourierInc: 1,
    unassignAfterStoreCollectInc: afterStoreCollect ? 1 : 0,
    clearStoreCollected: afterStoreCollect,
  };
}

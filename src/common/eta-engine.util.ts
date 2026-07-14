/**
 * ETA Engine — prédiction rule-based (substitut XGBoost / Gradient Boosting).
 * Entrées alignées ARCHITECTURE : road speed, traffic, driver, prep, weather.
 * Sorties : ETA, pickup delay, delivery delay.
 *
 * Branchement ML futur : remplacer `predictDeliveryEta` par un scoreur ONNX/XGBoost
 * en gardant le même contrat d’E/S.
 */

export type EtaEngineInputs = {
  /** Durée route OSRM/Directions (s). */
  roadDurationSeconds?: number | null;
  /** Distance route ou haversine (km). */
  distanceKm?: number | null;
  /** Vitesse moyenne profil / historique conducteur (km/h). */
  driverSpeedKmh?: number | null;
  /** Temps de préparation restaurant (min). */
  restaurantPrepMinutes?: number | null;
  /** Facteur trafic temps réel (≥1 = plus lent). Défaut 1. */
  trafficFactor?: number | null;
  /** Facteur météo (≥1 = plus lent). Défaut 1. */
  weatherFactor?: number | null;
  /** Retard historique moyen pickup (min). */
  historicalPickupDelayMinutes?: number | null;
  /** Retard historique moyen delivery (min). */
  historicalDeliveryDelayMinutes?: number | null;
  /** true si colis déjà récupéré (pas de prep dans ETA). */
  alreadyPickedUp?: boolean;
};

export type EtaEnginePrediction = {
  etaMinutes: number;
  pickupDelayMinutes: number;
  deliveryDelayMinutes: number;
  travelMinutes: number;
  source: 'route' | 'distance_fallback' | 'hybrid';
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function factor(raw: number | null | undefined): number {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return 1;
  return clamp(v, 0.7, 2.5);
}

/** Barème legacy km→minutes (aligné delivery-agent). */
export function distanceFallbackTravelMinutes(distanceKm: number): number {
  return Math.max(15, Math.round(distanceKm * 4 + 10));
}

/**
 * Prédiction ETA / retards — features style gradient boosting, formule déterministe.
 */
export function predictDeliveryEta(
  inputs: EtaEngineInputs,
): EtaEnginePrediction {
  const traffic = factor(inputs.trafficFactor);
  const weather = factor(inputs.weatherFactor);
  const prep = Math.max(
    0,
    Math.round(Number(inputs.restaurantPrepMinutes) || 0),
  );
  const histPickup = Math.max(
    0,
    Number(inputs.historicalPickupDelayMinutes) || 0,
  );
  const histDelivery = Math.max(
    0,
    Number(inputs.historicalDeliveryDelayMinutes) || 0,
  );

  const roadS = Number(inputs.roadDurationSeconds);
  const km = Number(inputs.distanceKm);
  const speed = Number(inputs.driverSpeedKmh);

  let idealTravel: number;
  let source: EtaEnginePrediction['source'];

  if (Number.isFinite(roadS) && roadS > 0) {
    idealTravel = roadS / 60;
    source = 'route';
    if (Number.isFinite(km) && km > 0 && Number.isFinite(speed) && speed > 0) {
      const fromSpeed = (km / speed) * 60;
      // Blend léger durée route ↔ vitesse observée conducteur (features GB).
      idealTravel = idealTravel * 0.7 + fromSpeed * 0.3;
      source = 'hybrid';
    }
  } else if (Number.isFinite(km) && km > 0) {
    if (Number.isFinite(speed) && speed > 0) {
      idealTravel = (km / speed) * 60;
      source = 'hybrid';
    } else {
      idealTravel = distanceFallbackTravelMinutes(km);
      source = 'distance_fallback';
    }
  } else {
    idealTravel = 45;
    source = 'distance_fallback';
  }

  const travelMinutes = clamp(
    Math.ceil(idealTravel * traffic * weather),
    1,
    240,
  );
  const pickupDelayMinutes = inputs.alreadyPickedUp
    ? 0
    : Math.round(prep + histPickup * weather);
  const deliveryDelayMinutes = Math.round(
    Math.max(0, travelMinutes - idealTravel) + histDelivery,
  );
  const etaMinutes = clamp(
    travelMinutes + pickupDelayMinutes,
    1,
    300,
  );

  return {
    etaMinutes,
    pickupDelayMinutes,
    deliveryDelayMinutes,
    travelMinutes,
    source,
  };
}

/** Libellé affichage catalogue / offres livreur. */
export function formatEtaMinutesLabel(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min`;
}

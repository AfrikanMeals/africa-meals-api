import type {
  GainEstimateAiBlock,
  GainEstimatePayload,
} from './gain-estimate.types';
import { roundCad } from './gain-estimate-build.util';

function amountOf(
  payload: Omit<GainEstimatePayload, 'ai'>,
  key: string,
): number {
  return (
    payload.breakdown.find((r) => r.key === key)?.amountCad ?? 0
  );
}

/**
 * Résumé + suggestions sans LLM — règles métier testables.
 * Utilisé si Groq/Ollama indisponible ou parse invalide.
 */
export function buildGainEstimateHeuristicAi(
  payload: Omit<GainEstimatePayload, 'ai'>,
  locale: 'fr' | 'en' = 'fr',
): GainEstimateAiBlock {
  const { netCad, revenueCad, costCad, verdict } = payload.totals;
  const orderFees =
    amountOf(payload, 'order_commission') +
    amountOf(payload, 'order_payment_fee');
  const stripe = amountOf(payload, 'stripe_processing');
  const ads = amountOf(payload, 'ad_credit');
  const sms =
    amountOf(payload, 'sms_paid') + amountOf(payload, 'sms_pending');
  const vendorSubs = amountOf(payload, 'vendor_subscriptions');
  const partnerSubs = amountOf(payload, 'partner_subscriptions');
  const marketingShare =
    revenueCad > 0 ? roundCad(((ads + sms) / revenueCad) * 100) : 0;
  const stripeShareOfOrderFees =
    orderFees > 0 ? roundCad((stripe / orderFees) * 100) : 0;

  const suggestions: string[] = [];
  let summary: string;

  if (locale === 'en') {
    summary =
      verdict === 'profit'
        ? `Wise Eat is estimated profitable over the period: net ≈ ${netCad} CAD (revenue ${revenueCad} − Stripe cost ${costCad}).`
        : verdict === 'loss'
          ? `Wise Eat is estimated at a loss over the period: net ≈ ${netCad} CAD (revenue ${revenueCad} − Stripe cost ${costCad}).`
          : `Wise Eat is roughly break-even over the period: net ≈ ${netCad} CAD.`;

    if (verdict === 'loss') {
      suggestions.push(
        'Review order commission and customer payment fees on Platform fees — take rate may be below Stripe costs.',
      );
      suggestions.push(
        'Audit free/trial vendor and partner plans that generate little recurring revenue.',
      );
    }
    if (stripeShareOfOrderFees >= 60 && orderFees > 0) {
      suggestions.push(
        `Stripe processing is ~${stripeShareOfOrderFees}% of order-related platform fees — consider raising take rate or fee modes.`,
      );
    }
    if (marketingShare < 5 && revenueCad > 0) {
      suggestions.push(
        'Ad Credit + SMS are a small share of platform revenue — push monetization of ads and SMS packs.',
      );
    }
    if (
      payload.planSnapshot.vendorActiveCount > 0 &&
      payload.planSnapshot.vendorAvgPricePaidCad <
        payload.planSnapshot.vendorCatalogAvgMonthlyCad * 0.5 &&
      payload.planSnapshot.vendorCatalogAvgMonthlyCad > 0
    ) {
      suggestions.push(
        'Average vendor subscription paid is well below catalog monthly prices — review discounts, offers, and free tiers.',
      );
    }
    if (vendorSubs + partnerSubs < revenueCad * 0.1 && revenueCad > 50) {
      suggestions.push(
        'Subscriptions are a small revenue share — consider upselling paid plans for high-volume vendors/partners.',
      );
    }
    if (suggestions.length === 0) {
      suggestions.push(
        'Keep monitoring take rate vs Stripe costs and grow Ad Credit / SMS as secondary revenue.',
      );
    }
  } else {
    summary =
      verdict === 'profit'
        ? `Wise Eat est estimé rentable sur la période : net ≈ ${netCad} CAD (revenus ${revenueCad} − coût Stripe ${costCad}).`
        : verdict === 'loss'
          ? `Wise Eat est estimé en perte sur la période : net ≈ ${netCad} CAD (revenus ${revenueCad} − coût Stripe ${costCad}).`
          : `Wise Eat est approximativement à l’équilibre sur la période : net ≈ ${netCad} CAD.`;

    if (verdict === 'loss') {
      suggestions.push(
        'Revoir la commission commandes et les frais de transaction client (Frais de plateforme) — le take rate peut être inférieur aux coûts Stripe.',
      );
      suggestions.push(
        'Auditer les formules gratuites / essais vendeur et partenaire qui génèrent peu de revenu récurrent.',
      );
    }
    if (stripeShareOfOrderFees >= 60 && orderFees > 0) {
      suggestions.push(
        `Le traitement Stripe représente ~${stripeShareOfOrderFees} % des frais plateforme liés aux commandes — envisager d’augmenter le take rate ou les modes de frais.`,
      );
    }
    if (marketingShare < 5 && revenueCad > 0) {
      suggestions.push(
        'Ad Credit + SMS pèsent peu dans les revenus plateforme — renforcer la monétisation pubs et packs SMS.',
      );
    }
    if (
      payload.planSnapshot.vendorActiveCount > 0 &&
      payload.planSnapshot.vendorAvgPricePaidCad <
        payload.planSnapshot.vendorCatalogAvgMonthlyCad * 0.5 &&
      payload.planSnapshot.vendorCatalogAvgMonthlyCad > 0
    ) {
      suggestions.push(
        'Le prix moyen payé des abonnements vendeur est nettement sous le catalogue mensuel — revoir remises, offres et free tiers.',
      );
    }
    if (vendorSubs + partnerSubs < revenueCad * 0.1 && revenueCad > 50) {
      suggestions.push(
        'Les abonnements sont une faible part du revenu — upsell de formules payantes pour les vendeurs / partenaires à fort volume.',
      );
    }
    if (suggestions.length === 0) {
      suggestions.push(
        'Continuer à suivre le take rate vs coûts Stripe et développer Ad Credit / SMS comme revenus secondaires.',
      );
    }
  }

  return {
    source: 'heuristic',
    summary,
    suggestions: suggestions.slice(0, 6),
  };
}

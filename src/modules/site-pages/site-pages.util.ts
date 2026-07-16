import type { SitePageDocument } from '@schemas/site-page.schema';
import {
  emptyVendorContent,
  type SitePageFaqItem,
  type SitePageLabeledItem,
  type SitePageTextLink,
  type VendorSitePageContent,
} from './site-page-content.types';

export function normalizeSitePageLocale(raw: string | undefined): string {
  return (raw ?? 'fr').trim().toLowerCase().slice(0, 8) || 'fr';
}

/** Locale demandée → FR → premier doc du slug (même ordre que policies). */
export function pickSitePageByLocale<
  T extends { slug: string; locale: string },
>(docs: T[], slug: string, locale: string): T | undefined {
  return (
    docs.find((d) => d.slug === slug && d.locale === locale) ??
    docs.find((d) => d.slug === slug && d.locale === 'fr') ??
    docs.find((d) => d.slug === slug)
  );
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asLabeledItems(raw: unknown): SitePageLabeledItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      title: asString(row.title),
      text: asString(row.text),
    };
  });
}

function asHighlights(raw: unknown): SitePageTextLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const link = asString(row.link);
    return {
      title: asString(row.title),
      text: asString(row.text),
      ...(link ? { link } : {}),
    };
  });
}

function asFaqItems(raw: unknown): SitePageFaqItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const out: SitePageFaqItem = {
      q: asString(row.q),
      a: asString(row.a),
    };
    // HTML autorisé seulement si flag explicite (liens internes FAQ).
    if (row.html === true) out.html = true;
    return out;
  });
}

/**
 * Normalise le Mixed Mongo vers la shape vendor (champs manquants → vides).
 * Évite les crashs web/admin si un bloc a été partiellement édité.
 */
export function normalizeVendorContent(raw: unknown): VendorSitePageContent {
  const base = emptyVendorContent();
  const src =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const hero =
    src.hero && typeof src.hero === 'object'
      ? (src.hero as Record<string, unknown>)
      : {};
  const pills =
    src.pills && typeof src.pills === 'object'
      ? (src.pills as Record<string, unknown>)
      : {};
  const why =
    src.why && typeof src.why === 'object'
      ? (src.why as Record<string, unknown>)
      : {};
  const tools =
    src.tools && typeof src.tools === 'object'
      ? (src.tools as Record<string, unknown>)
      : {};
  const steps =
    src.steps && typeof src.steps === 'object'
      ? (src.steps as Record<string, unknown>)
      : {};
  const pricingCopy =
    src.pricingCopy && typeof src.pricingCopy === 'object'
      ? (src.pricingCopy as Record<string, unknown>)
      : {};
  const faq =
    src.faq && typeof src.faq === 'object'
      ? (src.faq as Record<string, unknown>)
      : {};
  const cta =
    src.cta && typeof src.cta === 'object'
      ? (src.cta as Record<string, unknown>)
      : {};

  return {
    hero: {
      badge: asString(hero.badge, base.hero.badge),
      h1: asString(hero.h1, base.hero.h1),
      lead: asString(hero.lead, base.hero.lead),
      btnAdmin: asString(hero.btnAdmin, base.hero.btnAdmin),
      btnPricing: asString(hero.btnPricing, base.hero.btnPricing),
    },
    pills: {
      why: asString(pills.why, base.pills.why),
      tools: asString(pills.tools, base.pills.tools),
      steps: asString(pills.steps, base.pills.steps),
      pricing: asString(pills.pricing, base.pills.pricing),
      faq: asString(pills.faq, base.pills.faq),
    },
    highlights: asHighlights(src.highlights),
    why: {
      title: asString(why.title, base.why.title),
      lead: asString(why.lead, base.why.lead),
      perks: asLabeledItems(why.perks),
    },
    tools: {
      title: asString(tools.title, base.tools.title),
      lead: asString(tools.lead, base.tools.lead),
      imageUrl: asString(tools.imageUrl, base.tools.imageUrl),
      imageAlt: asString(tools.imageAlt, base.tools.imageAlt),
      items: asLabeledItems(tools.items),
    },
    steps: {
      title: asString(steps.title, base.steps.title),
      lead: asString(steps.lead, base.steps.lead),
      items: asLabeledItems(steps.items),
    },
    pricingCopy: {
      title: asString(pricingCopy.title, base.pricingCopy.title),
      lead: asString(pricingCopy.lead, base.pricingCopy.lead),
      commissionTitle: asString(
        pricingCopy.commissionTitle,
        base.pricingCopy.commissionTitle,
      ),
      commissionText: asString(
        pricingCopy.commissionText,
        base.pricingCopy.commissionText,
      ),
      link: asString(pricingCopy.link, base.pricingCopy.link),
      feesRateFree: asString(
        pricingCopy.feesRateFree,
        base.pricingCopy.feesRateFree,
      ),
      feesNoteEstimated: asString(
        pricingCopy.feesNoteEstimated,
        base.pricingCopy.feesNoteEstimated,
      ),
    },
    faq: {
      title: asString(faq.title, base.faq.title),
      lead: asString(faq.lead, base.faq.lead),
      items: asFaqItems(faq.items),
    },
    cta: {
      title: asString(cta.title, base.cta.title),
      lead: asString(cta.lead, base.cta.lead),
      btnAdmin: asString(cta.btnAdmin, base.cta.btnAdmin),
      btnContact: asString(cta.btnContact, base.cta.btnContact),
      disclaimer: asString(cta.disclaimer, base.cta.disclaimer),
    },
  };
}

function pageTimestamps(doc: SitePageDocument) {
  const t = doc as SitePageDocument & { updatedAt?: Date; createdAt?: Date };
  return {
    updatedAt: t.updatedAt?.toISOString?.() ?? null,
    createdAt: t.createdAt?.toISOString?.() ?? null,
  };
}

export function serializeSitePage(
  doc: SitePageDocument,
  opts?: { localeFallback?: boolean },
) {
  const { updatedAt, createdAt } = pageTimestamps(doc);
  return {
    id: String(doc._id),
    slug: doc.slug,
    locale: doc.locale,
    title: doc.title,
    metaTitle: doc.metaTitle ?? '',
    metaDescription: doc.metaDescription ?? '',
    content: normalizeVendorContent(doc.content),
    isPublished: Boolean(doc.isPublished),
    updatedAt,
    createdAt,
    ...(opts?.localeFallback ? { localeFallback: true } : {}),
  };
}

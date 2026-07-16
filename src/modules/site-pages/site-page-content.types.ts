/** Types du contenu marketing landing vendor (API ↔ admin ↔ web). */

export type SitePageTextLink = {
  title: string;
  text: string;
  link?: string;
};

export type SitePageLabeledItem = {
  title: string;
  text: string;
};

export type SitePageFaqItem = {
  q: string;
  a: string;
  /** Si true, `a` peut contenir du HTML (liens internes). */
  html?: boolean;
};

export type VendorSitePageContent = {
  hero: {
    badge: string;
    h1: string;
    lead: string;
    btnAdmin: string;
    btnPricing: string;
  };
  pills: {
    why: string;
    tools: string;
    steps: string;
    pricing: string;
    faq: string;
  };
  highlights: SitePageTextLink[];
  why: {
    title: string;
    lead: string;
    perks: SitePageLabeledItem[];
  };
  tools: {
    title: string;
    lead: string;
    imageUrl: string;
    imageAlt: string;
    items: SitePageLabeledItem[];
  };
  steps: {
    title: string;
    lead: string;
    items: SitePageLabeledItem[];
  };
  pricingCopy: {
    title: string;
    lead: string;
    commissionTitle: string;
    commissionText: string;
    link: string;
    feesRateFree: string;
    feesNoteEstimated: string;
  };
  faq: {
    title: string;
    lead: string;
    items: SitePageFaqItem[];
  };
  cta: {
    title: string;
    lead: string;
    btnAdmin: string;
    btnContact: string;
    disclaimer: string;
  };
};

export function emptyVendorContent(): VendorSitePageContent {
  return {
    hero: { badge: '', h1: '', lead: '', btnAdmin: '', btnPricing: '' },
    pills: { why: '', tools: '', steps: '', pricing: '', faq: '' },
    highlights: [],
    why: { title: '', lead: '', perks: [] },
    tools: { title: '', lead: '', imageUrl: '', imageAlt: '', items: [] },
    steps: { title: '', lead: '', items: [] },
    pricingCopy: {
      title: '',
      lead: '',
      commissionTitle: '',
      commissionText: '',
      link: '',
      feesRateFree: '',
      feesNoteEstimated: '',
    },
    faq: { title: '', lead: '', items: [] },
    cta: {
      title: '',
      lead: '',
      btnAdmin: '',
      btnContact: '',
      disclaimer: '',
    },
  };
}

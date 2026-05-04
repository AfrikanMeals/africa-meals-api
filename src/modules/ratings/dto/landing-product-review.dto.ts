/** Avis plat public pour la page marketing (pas d’identifiants internes). */
export type LandingProductReviewItem = {
  stars: number;
  quote: string;
  author: string;
  meta: string;
};

export type LandingProductReviewsResponse = {
  reviews: LandingProductReviewItem[];
};

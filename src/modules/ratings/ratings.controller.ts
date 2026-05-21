import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RatingsService } from './ratings.service';

@ApiTags('ratings')
@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  /**
   * Avis d’un plat (pagination) — public, pour la fiche produit mobile / web.
   */
  @Get('products/:productId/reviews')
  @ApiOperation({
    summary: 'Avis paginés par plat',
    description:
      '`page` ≥ 1, `take` 1–50 (défaut 20). Tri : plus récents en premier.',
  })
  listProductReviews(
    @Param('productId') productId: string,
    @Query('page') pageRaw?: string,
    @Query('take') takeRaw?: string,
  ) {
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    const take = Math.min(50, Math.max(1, parseInt(takeRaw ?? '20', 10) || 20));
    return this.ratingsService.listProductReviewsPaginated(productId, {
      page,
      take,
    });
  }

  /**
   * Avis plats d’une boutique (pagination) — public, onglet Avis fiche restaurant.
   */
  @Get('stores/:storeId/reviews')
  @ApiOperation({
    summary: 'Avis paginés par boutique',
    description:
      'Agrège les avis `product_ratings` des plats du restaurant. `page` ≥ 1, `take` 1–50 (défaut 20). Tri : plus récents en premier.',
  })
  listStoreReviews(
    @Param('storeId') storeId: string,
    @Query('page') pageRaw?: string,
    @Query('take') takeRaw?: string,
  ) {
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    const take = Math.min(50, Math.max(1, parseInt(takeRaw ?? '20', 10) || 20));
    return this.ratingsService.listStoreReviewsPaginated(storeId, {
      page,
      take,
    });
  }

  /**
   * Avis produits récents (note ≥ 4) pour la landing web — public, sans authentification.
   */
  @Get('landing')
  @Header('Cache-Control', 'public, max-age=120, stale-while-revalidate=600')
  @ApiOperation({
    summary: 'Avis positifs pour la page marketing',
    description:
      'Jusqu’à 10 avis sur les plats (collection `product_ratings`), note ≥ 4, avec commentaire. Données allégées (pas d’e-mail ni d’identifiants).',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Nombre max d’avis (1 à 10, défaut 10)',
  })
  landingProductReviews(@Query('limit') limitRaw?: string) {
    const parsed =
      limitRaw != null && limitRaw !== ''
        ? parseInt(limitRaw, 10)
        : undefined;
    return this.ratingsService.listLandingProductReviews(parsed);
  }
}

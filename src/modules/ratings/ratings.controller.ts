import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RatingsService } from './ratings.service';

@ApiTags('ratings')
@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

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

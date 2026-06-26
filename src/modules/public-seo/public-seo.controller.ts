import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PublicSeoService } from './public-seo.service';

@ApiTags('platform-seo')
@Controller('platform/seo')
export class PublicSeoController {
  constructor(private readonly _publicSeo: PublicSeoService) {}

  @Get('sitemap/stores')
  @ApiOperation({
    summary:
      'Liste paginée des boutiques actives indexables (ACTIVE + Stripe Connect)',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 1000 })
  listSitemapStores(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this._publicSeo.listSitemapStores(page, limit);
  }

  @Get('sitemap/products')
  @ApiOperation({
    summary:
      'Liste paginée des produits actifs indexables (ACTIVE + boutique visible app)',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 1000 })
  listSitemapProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this._publicSeo.listSitemapProducts(page, limit);
  }

  @Get('sitemap/drinks')
  @ApiOperation({
    summary:
      'Liste paginée des boissons en stock indexables (boutique ACTIVE + Stripe Connect)',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 1000 })
  listSitemapDrinks(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this._publicSeo.listSitemapDrinks(page, limit);
  }
}

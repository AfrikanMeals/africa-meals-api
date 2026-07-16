import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ProductBundleFeedQueryDto,
  TrackProductBundleDto,
} from './dto/product-bundles.dto';
import { ProductBundlesService } from './product-bundles.service';

/** Endpoints publics bundles — feed accueil, aperçu Ads, tracking. */
@ApiTags('product-bundles')
@Controller('product-bundles')
export class ProductBundlesFeedController {
  @Inject(ProductBundlesService)
  private readonly bundles: ProductBundlesService;

  @Get('feed')
  @UseGuards(OptionalAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Feed accueil — bundles actifs multi-boutiques.',
  })
  feed(@Query() query: ProductBundleFeedQueryDto) {
    return this.bundles.getBundleFeed({
      take: query.take,
      regionCode: query.regionCode,
    });
  }

  @Get(':bundleId/preview')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Aperçu bundle — navigation Ads sans checkout direct.',
  })
  preview(@Param('bundleId') bundleId: string) {
    return this.bundles.getBundlePreview(bundleId);
  }

  @Post(':bundleId/track')
  @HttpCode(204)
  @UseGuards(OptionalAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Tracking engagement bundle (clic / checkout).' })
  async track(
    @Param('bundleId') bundleId: string,
    @Body() body: TrackProductBundleDto,
  ): Promise<void> {
    await this.bundles.trackEngagement(bundleId, body.event);
  }
}

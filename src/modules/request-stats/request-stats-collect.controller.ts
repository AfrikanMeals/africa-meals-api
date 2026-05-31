import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { CollectVendorAnalyticsDto } from './dto/collect-vendor-analytics.dto';

class ItemIdParamDto {
  @IsMongoId()
  id: string;
}

@ApiTags('request-stats')
@Controller('request-stats')
export class RequestStatsCollectController {
  @Post('store-menu')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Collecte mobile non bloquante: vue de page menu boutique (storeId requis)',
  })
  collectStoreMenu(@Body() body: CollectVendorAnalyticsDto) {
    return { ok: true, storeId: body.storeId };
  }

  @Post('products/:id')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Collecte mobile non bloquante: vue fiche produit',
  })
  collectProductView(
    @Param() params: ItemIdParamDto,
    @Body() body: CollectVendorAnalyticsDto,
  ) {
    return { ok: true, productId: params.id, storeId: body.storeId };
  }

  @Post('drinks/:id')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Collecte mobile non bloquante: vue fiche boisson',
  })
  collectDrinkView(
    @Param() params: ItemIdParamDto,
    @Body() body: CollectVendorAnalyticsDto,
  ) {
    return { ok: true, drinkId: params.id, storeId: body.storeId };
  }
}

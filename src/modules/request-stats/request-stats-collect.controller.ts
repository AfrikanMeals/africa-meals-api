import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  VendorAnalyticsEventTypeEnum,
  VendorAnalyticsItemKindEnum,
} from '@schemas/vendor-analytics-event.schema';
import { UserModel } from '@schemas/user.schema';
import { IsMongoId } from 'class-validator';
import { CollectVendorAnalyticsDto } from './dto/collect-vendor-analytics.dto';
import { VendorAnalyticsCollectService } from './vendor-analytics-collect.service';

class ItemIdParamDto {
  @IsMongoId()
  id: string;
}

@ApiTags('request-stats')
@Controller('request-stats')
export class RequestStatsCollectController {
  constructor(
    private readonly vendorAnalyticsCollect: VendorAnalyticsCollectService,
  ) {}

  @Post('store-menu')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Collecte mobile non bloquante: vue de page menu boutique (storeId requis)',
  })
  collectStoreMenu(
    @Body() body: CollectVendorAnalyticsDto,
    @Req() req: Request,
  ) {
    const user = req.user as UserModel | undefined;
    return this.vendorAnalyticsCollect.record({
      storeId: body.storeId,
      userId: user?._id?.toString(),
      eventType: VendorAnalyticsEventTypeEnum.STORE_PAGE_VIEW,
    });
  }

  @Post('store-session')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Collecte mobile: durée passée sur la page boutique',
  })
  collectStoreSession(
    @Body() body: CollectVendorAnalyticsDto,
    @Req() req: Request,
  ) {
    const user = req.user as UserModel | undefined;
    return this.vendorAnalyticsCollect.record({
      storeId: body.storeId,
      userId: user?._id?.toString(),
      eventType: VendorAnalyticsEventTypeEnum.STORE_SESSION,
      durationSec: body.durationSec,
    });
  }

  @Post('store-engagement')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Collecte mobile: engagement sur la boutique (onglet, panier, etc.)',
  })
  collectStoreEngagement(
    @Body() body: CollectVendorAnalyticsDto,
    @Req() req: Request,
  ) {
    const user = req.user as UserModel | undefined;
    return this.vendorAnalyticsCollect.record({
      storeId: body.storeId,
      userId: user?._id?.toString(),
      eventType: VendorAnalyticsEventTypeEnum.STORE_ENGAGEMENT,
      engagement: body.engagement,
    });
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
    @Req() req: Request,
  ) {
    const user = req.user as UserModel | undefined;
    return this.vendorAnalyticsCollect.record({
      storeId: body.storeId,
      userId: user?._id?.toString(),
      eventType: VendorAnalyticsEventTypeEnum.PRODUCT_VIEW,
      itemId: params.id,
      itemKind: VendorAnalyticsItemKindEnum.PRODUCT,
    });
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
    @Req() req: Request,
  ) {
    const user = req.user as UserModel | undefined;
    return this.vendorAnalyticsCollect.record({
      storeId: body.storeId,
      userId: user?._id?.toString(),
      eventType: VendorAnalyticsEventTypeEnum.DRINK_VIEW,
      itemId: params.id,
      itemKind: VendorAnalyticsItemKindEnum.DRINK,
    });
  }
}

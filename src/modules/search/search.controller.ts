import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
import {
  clientPlatformFromRequest,
  resolveMongoIdFromPublicParam,
} from '@common/catalog-public-id.util';
import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { SearchDto } from './dto/search.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  @Inject(SearchService)
  private readonly _searchService: SearchService;

  /**
   * Menu boutique paginé (même payload que `GET /search` côté `products`, mais **sans** 2e requête populate).
   */
  @Get('store-menu-products')
  @UseGuards(OptionalAuthGuard)
  async storeMenuProducts(
    @Req() req: Request,
    @Query('storeId') storeId: string,
    @Query('page') pageRaw?: string,
    @Query('take') takeRaw?: string,
    @Query('q') q?: string,
    @Query('countryCode') countryCode?: string,
  ) {
    const sid =
      resolveMongoIdFromPublicParam((storeId ?? '').trim()) ??
      (storeId ?? '').trim();
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    const take = Math.min(
      120,
      Math.max(8, parseInt(takeRaw ?? '24', 10) || 24),
    );
    const clientPlatform = clientPlatformFromRequest(req);
    const { items, total } =
      await this._searchService.storeMenuProductsLeanPage(
        sid,
        page,
        take,
        req.user as UserModel,
        q,
        clientPlatform,
        countryCode,
      );
    return {
      products: {
        items,
        total,
        page,
        limit: take,
      },
    };
  }

  @Get('')
  @UseGuards(OptionalAuthGuard)
  async filter(
    @Req() req: Request,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    args: SearchDto,
  ) {
    return this._searchService.filter(args, req.user as UserModel);
  }
}

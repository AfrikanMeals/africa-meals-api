import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  CreateProductBundleDto,
  PatchProductBundleDto,
  ProductBundleImageJsonDto,
} from './dto/product-bundles.dto';
import { ProductBundlesService } from './product-bundles.service';

/** CRUD vendeur — bundles multi-produit liés à une boutique. */
@ApiTags('product-bundles')
@ApiBearerAuth('bearer')
@Controller('stores')
export class StoreProductBundlesController {
  @Inject(ProductBundlesService)
  private readonly bundles: ProductBundlesService;

  @Get(':storeId/product-bundles')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Vendeur — lister les bundles de la boutique.' })
  list(@Req() req: Request, @Param('storeId') storeId: string) {
    return this.bundles.listForStore(storeId, req.user as UserModel);
  }

  /** Upload image avant create/patch — route dédiée (pas confondre avec :bundleId). */
  @Post(':storeId/product-bundles/image-json')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Vendeur — uploader l’image de couverture d’un bundle (JSON+base64).',
  })
  uploadImage(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Body() body: ProductBundleImageJsonDto,
  ) {
    return this.bundles.uploadBundleImage(
      storeId,
      body,
      req.user as UserModel,
    );
  }

  @Post(':storeId/product-bundles')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Vendeur — créer un bundle multi-produit.' })
  create(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Body() body: CreateProductBundleDto,
  ) {
    return this.bundles.createForStore(storeId, body, req.user as UserModel);
  }

  @Patch(':storeId/product-bundles/:bundleId')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Vendeur — modifier un bundle.' })
  patch(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Param('bundleId') bundleId: string,
    @Body() body: PatchProductBundleDto,
  ) {
    return this.bundles.patchForStore(
      storeId,
      bundleId,
      body,
      req.user as UserModel,
    );
  }

  @Delete(':storeId/product-bundles/:bundleId')
  @UseGuards(JwtGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Vendeur — supprimer un bundle.' })
  async delete(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Param('bundleId') bundleId: string,
  ): Promise<void> {
    await this.bundles.deleteForStore(
      storeId,
      bundleId,
      req.user as UserModel,
    );
  }
}

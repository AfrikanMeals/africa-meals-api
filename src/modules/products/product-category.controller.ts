import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  CreateProductCategoryDto,
  PatchProductCategoryDto,
} from './dto/product-category.dto';
import { ProductCategoryImageJsonDto } from './dto/product-category-image.dto';
import { slimProductCategoryForPublicClient } from '@utils/public-client-shapes';
import { ProductCategoryService } from './product-category.service';

@ApiTags('products')
@Controller('product-categories')
export class ProductCategoryController {
  private readonly _logger = new Logger(ProductCategoryController.name);

  @Inject(ProductCategoryService)
  private readonly _productCategoryService: ProductCategoryService;

  @Get('')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  async filter() {
    try {
      const rows = await this._productCategoryService.filter();
      return rows.map((r) =>
        slimProductCategoryForPublicClient(
          r as unknown as Record<string, unknown>,
        ),
      );
    } catch (e) {
      this._logger.error(
        `GET /product-categories failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
      return [];
    }
  }

  @Post('')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async create(
    @Body(ValidationPipe) body: CreateProductCategoryDto,
    @Req() req: Request,
  ) {
    return this._productCategoryService.create(body, req.user as UserModel);
  }

  @Post('image-json')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async uploadImage(
    @Body(ValidationPipe) body: ProductCategoryImageJsonDto,
    @Req() req: Request,
  ) {
    return this._productCategoryService.uploadCategoryImage(
      req.user as UserModel,
      body,
    );
  }

  @Patch(':id')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async patch(
    @Param('id') id: string,
    @Body(ValidationPipe) body: PatchProductCategoryDto,
    @Req() req: Request,
  ) {
    return this._productCategoryService.update(id, body, req.user as UserModel);
  }

  @Delete(':id')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async remove(@Param('id') id: string, @Req() req: Request) {
    await this._productCategoryService.remove(id, req.user as UserModel);
  }
}

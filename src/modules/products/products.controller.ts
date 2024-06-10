import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Get(':id')
  async getOneById(@Param('id') id: string) {
    return this._productsService.findOneById(id);
  }
}

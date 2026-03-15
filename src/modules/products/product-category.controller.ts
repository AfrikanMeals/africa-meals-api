import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProductCategoryService } from './product-category.service';

@ApiTags('products')
@Controller('product-categories')
export class ProductCategoryController {
  @Inject(ProductCategoryService)
  private readonly _productCategoryService: ProductCategoryService;

  @Get('')
  async filter() {
    return this._productCategoryService.filter();
  }
}

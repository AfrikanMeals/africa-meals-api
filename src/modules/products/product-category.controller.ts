import { Controller, Get, Inject } from '@nestjs/common';
import { ProductCategoryService } from './product-category.service';

@Controller('product-categories')
export class ProductCategoryController {
  @Inject(ProductCategoryService)
  private readonly _productCategoryService: ProductCategoryService;

  @Get('')
  async filter() {
    return this._productCategoryService.filter();
  }
}

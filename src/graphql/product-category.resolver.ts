import { ProductCategoryService } from '@modules/products/product-category.service';
import { Inject } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import { ProductCategoryPublicGql } from './types/product-category.types';

@Resolver()
export class ProductCategoryResolver {
  @Inject(ProductCategoryService)
  private readonly _categories: ProductCategoryService;

  @Query(() => [ProductCategoryPublicGql], {
    name: 'productCategories',
    description:
      'Liste des catégories + nombre de produits (cache serveur + HTTP côté REST).',
  })
  async productCategories(): Promise<ProductCategoryPublicGql[]> {
    const rows = await this._categories.filter();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      isEnabled: r.isEnabled,
      productCount: r.productCount,
    }));
  }
}

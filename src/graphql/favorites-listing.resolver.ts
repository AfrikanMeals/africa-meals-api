import { ProductsService } from '@modules/products/products.service';
import { UserModel } from '@schemas/user.schema';
import { UseGuards, Inject } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { GqlUser } from './decorators/gql-user.decorator';
import { GqlJwtGuard } from './guards/gql-jwt.guard';
import { FavoriteProductsListingPageGql } from './types/favorite-listing.types';

@Resolver()
export class FavoritesListingResolver {
  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Query(() => FavoriteProductsListingPageGql, {
    name: 'myFavoriteProductsListing',
    description:
      'Liste paginée des favoris (champs minimaux pour l’écran liste). Préféré au REST pour réduire le transfert.',
  })
  @UseGuards(GqlJwtGuard)
  async myFavoriteProductsListing(
    @GqlUser() user: UserModel,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('take', { type: () => Int, defaultValue: 20 }) take: number,
  ): Promise<FavoriteProductsListingPageGql> {
    const p = Number.isFinite(page) && page >= 1 ? page : 1;
    const tRaw = Number.isFinite(take) && take >= 1 ? take : 20;
    const t = Math.min(100, Math.max(1, tRaw));
    return this._productsService.listFavoriteProductsListingForGraphql(
      user,
      p,
      t,
    ) as Promise<FavoriteProductsListingPageGql>;
  }
}

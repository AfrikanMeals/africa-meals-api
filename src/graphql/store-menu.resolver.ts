import { StoreMenuBundleService } from '@modules/store-menu-bundle/store-menu-bundle.service';
import { UserModel } from '@schemas/user.schema';
import { Inject, NotFoundException, UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { GqlOptionalUser } from './decorators/gql-optional-user.decorator';
import { OptionalGqlAuthGuard } from './guards/optional-gql-auth.guard';
import { StoreMenuPayloadGql } from './types/store-menu.types';

@Resolver()
export class StoreMenuResolver {
  @Inject(StoreMenuBundleService)
  private readonly _bundle: StoreMenuBundleService;

  @Query(() => StoreMenuPayloadGql, {
    name: 'storeMenu',
    description:
      'Méta boutique + produits pour l’écran menu (1 requête GraphQL, équivalent léger REST + search).',
  })
  @UseGuards(OptionalGqlAuthGuard)
  async storeMenu(
    @GqlOptionalUser() user: UserModel | undefined,
    @Args('storeId', { description: 'Identifiant Mongo de la boutique.' })
    storeId: string,
    @Args('productsTake', {
      type: () => Int,
      nullable: true,
      defaultValue: 24,
      description: 'Taille de page produits (8–120).',
    })
    productsTake?: number,
    @Args('productsPage', {
      type: () => Int,
      nullable: true,
      defaultValue: 1,
      description: 'Page produits (1-based), alignée sur GET /search.',
    })
    productsPage?: number,
  ): Promise<StoreMenuPayloadGql> {
    const take = productsTake ?? 24;
    const page = productsPage ?? 1;
    const { store, products, productsTotal } = await this._bundle.load(
      storeId,
      take,
      user,
      page,
    );
    if (store == null) {
      throw new NotFoundException('store_not_found');
    }
    return {
      store,
      products,
      productsCount: products.length,
      productsTotal,
    };
  }
}

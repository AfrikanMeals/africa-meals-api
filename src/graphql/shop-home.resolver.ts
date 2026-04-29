import { ShopHomeService } from '@modules/shop-home/shop-home.service';
import { UserModel } from '@schemas/user.schema';
import { Inject, UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { GqlOptionalUser } from './decorators/gql-optional-user.decorator';
import { OptionalGqlAuthGuard } from './guards/optional-gql-auth.guard';
import { ShopHomePayloadGql } from './types/shop-home.types';

@Resolver()
export class ShopHomeResolver {
  @Inject(ShopHomeService)
  private readonly _shopHome: ShopHomeService;

  @Query(() => ShopHomePayloadGql, {
    name: 'shopHome',
    description:
      'Bundle optimisé pour l’écran d’accueil boutique (1 requête, cache serveur, produits allégés).',
  })
  @UseGuards(OptionalGqlAuthGuard)
  async shopHome(
    @GqlOptionalUser() user: UserModel | undefined,
    @Args('productsTake', {
      type: () => Int,
      nullable: true,
      defaultValue: 48,
      description: 'Nombre max de produits (8–120).',
    })
    productsTake?: number,
  ): Promise<ShopHomePayloadGql> {
    const take = productsTake ?? 48;
    const data = await this._shopHome.load(user, take);
    return {
      ...data,
      productsCount: data.products.length,
    };
  }
}

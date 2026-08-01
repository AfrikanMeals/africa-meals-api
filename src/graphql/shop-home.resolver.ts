import { RecommendationsService } from '@modules/recommendations/recommendations.service';
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

  @Inject(RecommendationsService)
  private readonly _recommendations: RecommendationsService;

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
    @Args('recommendationsTake', {
      type: () => Int,
      nullable: true,
      defaultValue: 24,
      description: 'Taille du fil recommandations (4–48).',
    })
    recommendationsTake?: number,
    @Args('countryCode', {
      type: () => String,
      nullable: true,
      description: 'Pays ISO2 du catalogue (sinon profil JWT ou région primaire).',
    })
    countryCode?: string,
  ): Promise<ShopHomePayloadGql> {
    const take = productsTake ?? 48;
    const recTake = recommendationsTake ?? 24;
    const { catalogRegion, ...data } = await this._shopHome.load(
      user,
      take,
      countryCode,
    );
    const rec = await this._recommendations.getFeed(
      user,
      String(recTake),
      data.products,
      catalogRegion,
    );
    return {
      ...data,
      productsCount: data.products.length,
      recommendations: {
        products: rec.products,
        stores: rec.stores,
        drinks: rec.drinks,
        frequentlyBoughtTogether: rec.frequentlyBoughtTogether ?? [],
        buyAgain: rec.buyAgain ?? [],
      },
    };
  }
}

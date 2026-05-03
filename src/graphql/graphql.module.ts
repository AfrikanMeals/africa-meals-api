import { AuthModule } from '@modules/auth/auth.module';
import { ProductsModule } from '@modules/products/products.module';
import { RecommendationsModule } from '@modules/recommendations/recommendations.module';
import { ShopHomeModule } from '@modules/shop-home/shop-home.module';
import { StoreMenuBundleModule } from '@modules/store-menu-bundle/store-menu-bundle.module';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { FavoritesListingResolver } from './favorites-listing.resolver';
import { GqlJwtGuard } from './guards/gql-jwt.guard';
import { OptionalGqlAuthGuard } from './guards/optional-gql-auth.guard';
import { ProductCategoryResolver } from './product-category.resolver';
import { RecommendationsGraphqlResolver } from './recommendations.resolver';
import { ShopHomeResolver } from './shop-home.resolver';
import { StoreMenuResolver } from './store-menu.resolver';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      useGlobalPrefix: true,
      path: 'graphql',
      context: ({ req, res }) => ({ req, res }),
      playground: process.env.DISABLE_GRAPHQL_PLAYGROUND !== 'true',
      introspection: process.env.DISABLE_GRAPHQL_PLAYGROUND !== 'true',
    }),
    AuthModule,
    ProductsModule,
    ShopHomeModule,
    RecommendationsModule,
    StoreMenuBundleModule,
  ],
  providers: [
    FavoritesListingResolver,
    ProductCategoryResolver,
    ShopHomeResolver,
    RecommendationsGraphqlResolver,
    StoreMenuResolver,
    GqlJwtGuard,
    OptionalGqlAuthGuard,
  ],
})
export class GraphqlApiModule {}

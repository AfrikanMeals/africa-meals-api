import { AuthModule } from '@modules/auth/auth.module';
import { ProductsModule } from '@modules/products/products.module';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { FavoritesListingResolver } from './favorites-listing.resolver';
import { GqlJwtGuard } from './guards/gql-jwt.guard';

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
  ],
  providers: [FavoritesListingResolver, GqlJwtGuard],
})
export class GraphqlApiModule {}

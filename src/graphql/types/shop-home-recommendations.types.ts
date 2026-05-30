import { Field, ObjectType } from '@nestjs/graphql';
import { GraphQLJSONObject } from 'graphql-scalars';

/** Même forme que `GET /api/recommendations/feed` (produits / boutiques / boissons). */
@ObjectType({
  description: 'Fil recommandations aligné sur le REST `recommendations/feed`.',
})
export class ShopHomeRecommendationsGql {
  @Field(() => [GraphQLJSONObject])
  products: Record<string, unknown>[];

  @Field(() => [GraphQLJSONObject])
  stores: Record<string, unknown>[];

  @Field(() => [GraphQLJSONObject])
  drinks: Record<string, unknown>[];
}

import { Field, Int, ObjectType } from '@nestjs/graphql';
import { GraphQLJSONObject } from 'graphql-scalars';

@ObjectType({
  description:
    'Bundle écran menu boutique : fiche légère + produits (JSON aligné recherche / app mobile).',
})
export class StoreMenuPayloadGql {
  @Field(() => GraphQLJSONObject, {
    description:
      'Champs `menu-meta` (bio, profileImage, averageRating, name, …).',
  })
  store: Record<string, unknown>;

  @Field(() => [GraphQLJSONObject])
  products: Record<string, unknown>[];

  /** Nombre de produits dans cette réponse (= `products.length`). */
  @Field(() => Int)
  productsCount: number;

  /** Total produits pour la boutique (toutes pages confondues). */
  @Field(() => Int)
  productsTotal: number;
}

import { Field, Int, ObjectType } from '@nestjs/graphql';
import { GraphQLJSONObject } from 'graphql-scalars';

@ObjectType({
  description:
    'Données agrégées pour l’onglet Accueil (annonces, pubs, catégories, produits). Champs JSON = même forme que les endpoints REST, sous-ensemble possible selon le resolver.',
})
export class ShopHomePayloadGql {
  @Field(() => [GraphQLJSONObject])
  announcements: Record<string, unknown>[];

  @Field(() => [GraphQLJSONObject])
  ads: Record<string, unknown>[];

  @Field(() => [GraphQLJSONObject])
  categories: Record<string, unknown>[];

  @Field(() => [GraphQLJSONObject])
  products: Record<string, unknown>[];

  @Field(() => Int, {
    description: 'Nombre de produits renvoyés (plafonné côté serveur).',
  })
  productsCount: number;
}

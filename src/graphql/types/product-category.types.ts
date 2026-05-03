import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({
  description:
    'Catégorie produit (liste publique) — champs stricts, sans surcharge REST.',
})
export class ProductCategoryPublicGql {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field()
  icon!: string;

  @Field()
  isEnabled!: boolean;

  @Field(() => Int)
  productCount!: number;
}

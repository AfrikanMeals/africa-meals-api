import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { ProductCategoryKindEnum } from '@schemas/product-category.schema';

registerEnumType(ProductCategoryKindEnum, {
  name: 'ProductCategoryKind',
  description: 'Repas / plats ou boissons',
});

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

  @Field(() => ProductCategoryKindEnum)
  kind!: ProductCategoryKindEnum;

  @Field()
  isEnabled!: boolean;

  @Field(() => Int)
  productCount!: number;
}

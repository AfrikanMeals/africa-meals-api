import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class FavoriteCategoryListingGql {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field()
  icon: string;

  @Field()
  isEnabled: boolean;
}

@ObjectType()
export class FavoriteStoreListingGql {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  status: string;
}

@ObjectType()
export class FavoriteProductListingGql {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  profileImage?: string;

  @Field(() => Float)
  price: number;

  @Field(() => Float)
  discountPrice: number;

  @Field()
  currency: string;

  @Field()
  bio: string;

  @Field()
  originCountry: string;

  @Field(() => Int)
  likesCount: number;

  @Field(() => Float)
  averageRating: number;

  @Field()
  inCart: boolean;

  @Field(() => FavoriteCategoryListingGql, { nullable: true })
  category?: FavoriteCategoryListingGql | null;

  @Field(() => FavoriteStoreListingGql, { nullable: true })
  store?: FavoriteStoreListingGql | null;
}

@ObjectType()
export class FavoriteProductsListingPageGql {
  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => [FavoriteProductListingGql])
  items: FavoriteProductListingGql[];
}

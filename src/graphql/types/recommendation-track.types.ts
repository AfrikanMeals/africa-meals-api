import { Field, InputType, registerEnumType } from '@nestjs/graphql';
import { UserRecommendationSignalKind } from '@schemas/user-recommendation-signal.schema';

registerEnumType(UserRecommendationSignalKind, {
  name: 'RecommendationSignalKind',
  description: 'Type de signal pour recommandations (vues, recherche).',
});

@InputType({ description: 'Corps de `recommendationTrack` (JWT requis).' })
export class RecommendationTrackInput {
  @Field(() => UserRecommendationSignalKind)
  kind: UserRecommendationSignalKind;

  @Field({
    nullable: true,
    description: 'Obligatoire sauf pour `SEARCH_QUERY`.',
  })
  refId?: string;

  @Field({
    nullable: true,
    description: 'Obligatoire pour `SEARCH_QUERY` (2–200 car. après normalisation).',
  })
  searchTerm?: string;
}

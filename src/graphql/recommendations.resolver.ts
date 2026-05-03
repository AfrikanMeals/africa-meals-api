import { RecommendationsService } from '@modules/recommendations/recommendations.service';
import { TrackRecommendationDto } from '@modules/recommendations/dto/track-recommendation.dto';
import { UserModel } from '@schemas/user.schema';
import { UseGuards, Inject } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { GqlUser } from './decorators/gql-user.decorator';
import { GqlJwtGuard } from './guards/gql-jwt.guard';
import { RecommendationTrackInput } from './types/recommendation-track.types';

@Resolver()
export class RecommendationsGraphqlResolver {
  @Inject(RecommendationsService)
  private readonly _reco: RecommendationsService;

  @Mutation(() => Boolean, {
    name: 'recommendationTrack',
    description:
      'Enregistre un signal recommandations (JWT). Équivalent à `POST /recommendations/track`.',
  })
  @UseGuards(GqlJwtGuard)
  async recommendationTrack(
    @GqlUser() user: UserModel,
    @Args('input', { type: () => RecommendationTrackInput })
    input: RecommendationTrackInput,
  ): Promise<boolean> {
    const dto = plainToInstance(TrackRecommendationDto, {
      kind: input.kind,
      refId: input.refId,
      searchTerm: input.searchTerm,
    });
    await validateOrReject(dto, {
      whitelist: true,
      forbidUnknownValues: false,
    });
    await this._reco.track(user, dto);
    return true;
  }
}

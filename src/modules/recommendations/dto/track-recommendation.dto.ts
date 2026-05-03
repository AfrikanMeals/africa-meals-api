import { IsEnum, IsMongoId } from 'class-validator';
import { UserRecommendationSignalKind } from '@schemas/user-recommendation-signal.schema';

export class TrackRecommendationDto {
  @IsEnum(UserRecommendationSignalKind)
  kind: UserRecommendationSignalKind;

  @IsMongoId()
  refId: string;
}

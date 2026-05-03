import { UserRecommendationSignalKind } from '@schemas/user-recommendation-signal.schema';
import {
  IsEnum,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class TrackRecommendationDto {
  @IsEnum(UserRecommendationSignalKind)
  kind: UserRecommendationSignalKind;

  @ValidateIf(
    (o: TrackRecommendationDto) =>
      o.kind !== UserRecommendationSignalKind.SEARCH_QUERY,
  )
  @IsMongoId()
  refId?: string;

  @ValidateIf(
    (o: TrackRecommendationDto) =>
      o.kind === UserRecommendationSignalKind.SEARCH_QUERY,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  searchTerm?: string;
}

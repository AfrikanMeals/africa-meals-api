import { Transform } from 'class-transformer';
import { IsMongoId, IsOptional } from 'class-validator';

export class StripeConnectOnboardingDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? undefined : value,
  )
  @IsMongoId()
  storeId?: string;
}

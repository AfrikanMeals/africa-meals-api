import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdatePartnerBadgeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  payoutDelayDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  sortOrder?: number;
}

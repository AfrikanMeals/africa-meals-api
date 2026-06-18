import {
  CreateAdCampaignDto,
  PatchAdCampaignDto,
} from '@modules/ads/dto/ad-campaign.dto';
import { AdsTargetingEventTypeEnum } from '@schemas/ads-targeting-event.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AdsTargetingEventDto {
  @ApiProperty({ enum: AdsTargetingEventTypeEnum })
  @IsEnum(AdsTargetingEventTypeEnum)
  eventType: AdsTargetingEventTypeEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  userId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  deviceId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  sessionId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  appVersion: string;

  @ApiProperty()
  @IsString()
  @MaxLength(32)
  os: string;

  @ApiProperty()
  @IsDateString()
  timestamp: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  itemId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  adId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  campaignId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  placement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AdsTargetingIngestDto {
  @ApiProperty({ type: [AdsTargetingEventDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => AdsTargetingEventDto)
  events: AdsTargetingEventDto[];

  @ApiPropertyOptional({
    description:
      'Consentement tracking. Si false, les événements ne sont pas ingérés.',
  })
  @IsOptional()
  @IsBoolean()
  consentGiven?: boolean;
}

export class AdsTargetingRecommendQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  user_id?: string;

  @ApiPropertyOptional({ default: 'home_feed' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  placement?: string;

  @ApiPropertyOptional({
    description:
      'Index de position dans le placement (0 = premier slot). Fusionné en placement si absent de placement.',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  slot?: number;

  @ApiPropertyOptional({ default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pays ISO2 du catalogue client.' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;
}

export class CreateTargetingCampaignDto extends CreateAdCampaignDto {}

export class PatchTargetingCampaignDto extends PatchAdCampaignDto {}

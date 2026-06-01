import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AdCampaignEventTypeEnum } from '@schemas/ad-campaign-event.schema';

export class TrackAdCampaignEventDto {
  @ApiProperty()
  @IsMongoId()
  campaignId: string;

  @ApiProperty({ enum: AdCampaignEventTypeEnum })
  @IsEnum(AdCampaignEventTypeEnum)
  eventType: AdCampaignEventTypeEnum;

  @ApiProperty({ enum: ['PRODUCT', 'DRINK', 'STORE_ACTION'] })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  itemType: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  itemId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientInstallId?: string;
}

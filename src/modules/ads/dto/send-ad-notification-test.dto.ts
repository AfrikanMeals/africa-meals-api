import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { NotificationChannelsDto } from '@modules/ads/dto/ad-notification.dto';

export enum AdNotificationTestSourceEnum {
  SANDBOX = 'sandbox',
  BANNER = 'banner',
  CAMPAIGN = 'campaign',
}

export class SendAdNotificationTestDto {
  @ApiPropertyOptional({ description: 'ObjectId MongoDB du destinataire' })
  @IsOptional()
  @IsMongoId()
  targetUserId?: string;

  @ApiPropertyOptional({ description: 'E-mail du destinataire (alternative à targetUserId)' })
  @IsOptional()
  @IsEmail()
  targetEmail?: string;

  @ApiProperty({ enum: AdNotificationTestSourceEnum })
  @IsEnum(AdNotificationTestSourceEnum)
  source: AdNotificationTestSourceEnum;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.source === AdNotificationTestSourceEnum.BANNER)
  @IsMongoId()
  bannerId?: string;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.source === AdNotificationTestSourceEnum.CAMPAIGN)
  @IsMongoId()
  campaignId?: string;

  @ApiPropertyOptional({ description: 'Requis en mode sandbox' })
  @ValidateIf((o) => o.source === AdNotificationTestSourceEnum.SANDBOX)
  @IsMongoId()
  storeId?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  body?: string;

  @ApiProperty({ type: NotificationChannelsDto })
  @ValidateNested()
  @Type(() => NotificationChannelsDto)
  channels: NotificationChannelsDto;
}

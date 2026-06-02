import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class NotificationChannelsDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  sms?: boolean;
}

/** Add-on notifications sur bannière ou campagne. */
export class NotificationAddonDto {
  @ApiPropertyOptional({
    description: 'Active l’add-on notifications pour cette pub.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: NotificationChannelsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationChannelsDto)
  channels?: NotificationChannelsDto;
}

export class UpdateAdNotificationPricingDto {
  @ApiPropertyOptional({ example: 'CAD' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emailDeliveryCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emailInteractionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emailConversionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pushDeliveryCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pushInteractionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pushConversionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  inAppDeliveryCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  inAppInteractionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  inAppConversionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  smsDeliveryCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  smsInteractionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  smsConversionCad?: number;
}

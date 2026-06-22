import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdNotificationPricingKindEnum } from '@modules/ads/ad-notification-pricing-kind.enum';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
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

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;
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

export class UpdateAdNotificationChannelAvailabilityDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  sms?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;
}

export class UpdateAdNotificationPricingDto {
  @ApiPropertyOptional({
    example: 'CAD',
    deprecated: true,
    description:
      'Ignoré — la devise provient des paramètres Régions (SupportedCountries).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({
    description:
      'Canaux activés plateforme (admin). Les boutiques ne peuvent pas sélectionner un canal désactivé.',
    type: UpdateAdNotificationChannelAvailabilityDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAdNotificationChannelAvailabilityDto)
  availableChannels?: UpdateAdNotificationChannelAvailabilityDto;

  @ApiPropertyOptional({
    enum: AdNotificationPricingKindEnum,
    description:
      'Contexte tarifaire : bannières (banner) ou campagnes (campaign). Défaut : banner.',
  })
  @IsOptional()
  @IsEnum(AdNotificationPricingKindEnum)
  kind?: AdNotificationPricingKindEnum;

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

  @IsOptional()
  @IsNumber()
  @Min(0)
  whatsappDeliveryCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whatsappInteractionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whatsappConversionCad?: number;
}

import { NotificationAddonDto } from '@modules/ads/dto/ad-notification.dto';
import { AdCampaignItemTypeEnum } from '@schemas/ad-campaign.schema';
import { StoreAdActionTypeEnum } from '@schemas/ad.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CampaignItemDto {
  @ApiProperty({ enum: AdCampaignItemTypeEnum })
  @IsEnum(AdCampaignItemTypeEnum)
  itemType: AdCampaignItemTypeEnum;

  @ApiPropertyOptional({ description: 'Obligatoire si itemType = PRODUCT' })
  @ValidateIf((o) => o.itemType === AdCampaignItemTypeEnum.PRODUCT)
  @IsNotEmpty()
  @IsMongoId()
  productId?: string;

  @ApiPropertyOptional({ description: 'Obligatoire si itemType = DRINK' })
  @ValidateIf((o) => o.itemType === AdCampaignItemTypeEnum.DRINK)
  @IsNotEmpty()
  @IsMongoId()
  drinkId?: string;
}

export class CreateAdCampaignDto {
  @ApiProperty()
  @IsMongoId()
  storeId: string;

  @ApiProperty({ example: 'Top picks de la semaine' })
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ example: 'Sélection spéciale mobile' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  subtitle?: string;

  @ApiPropertyOptional({ example: 'Description marketing affichée sur mobile' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: '2026-06-01T00:00:00.000Z' })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ example: '2026-06-30T23:59:59.999Z' })
  @IsDateString()
  endsAt: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    enum: StoreAdActionTypeEnum,
    default: StoreAdActionTypeEnum.SHOP,
  })
  @IsOptional()
  @IsEnum(StoreAdActionTypeEnum)
  actionType?: StoreAdActionTypeEnum;

  @ApiPropertyOptional({
    description: 'Texte du bouton de la carte action (fin de campagne).',
    example: 'Commander maintenant',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  actionText?: string;

  @ApiPropertyOptional({
    description:
      'Cible de l’action (URL, téléphone, email selon actionType). Ignoré pour SHOP/PRODUCT.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  actionTarget?: string;

  @ApiProperty({ type: [CampaignItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => CampaignItemDto)
  items: CampaignItemDto[];

  @ApiPropertyOptional({
    description:
      'Règles de ciblage (segments, intérêts, pays, exclusion conversion, etc.).',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  targetingRules?: Record<string, unknown>;
}

export class PatchAdCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  subtitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: StoreAdActionTypeEnum })
  @IsOptional()
  @IsEnum(StoreAdActionTypeEnum)
  actionType?: StoreAdActionTypeEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  actionText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  actionTarget?: string;

  @ApiPropertyOptional({ type: [CampaignItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => CampaignItemDto)
  items?: CampaignItemDto[];

  @ApiPropertyOptional({ description: 'Règles de ciblage', type: Object })
  @IsOptional()
  @IsObject()
  targetingRules?: Record<string, unknown>;

  @ApiPropertyOptional({ type: NotificationAddonDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationAddonDto)
  notificationAddon?: NotificationAddonDto;
}

import { NotificationAddonDto } from '@modules/ads/dto/ad-notification.dto';
import { StoreAdActionTypeEnum } from '@schemas/ad.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const AD_LINK_ACTION_TYPES: StoreAdActionTypeEnum[] = [
  StoreAdActionTypeEnum.WHATSAPP,
  StoreAdActionTypeEnum.CALL,
  StoreAdActionTypeEnum.EMAIL,
  StoreAdActionTypeEnum.WEBSITE,
];

export function isAdLinkActionType(t: StoreAdActionTypeEnum): boolean {
  return AD_LINK_ACTION_TYPES.includes(t);
}

export class CreateAdManagementDto {
  @ApiPropertyOptional({
    description:
      'ID boutique. Omis ou vide = bannière globale (admin uniquement).',
  })
  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @ApiProperty({ example: 'Livraison gratuite' })
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'Sur les commandes de plus de 25 $ cette semaine' })
  @IsString()
  @MaxLength(300)
  subtitle: string;

  @ApiProperty({ example: 'Commander' })
  @IsString()
  @MaxLength(80)
  actionText: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Région ISO2, ou ALL pour toutes les régions (obligatoire pour bannière globale).',
    example: 'ALL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  @Matches(/^(ALL|[A-Za-z]{2})$/i, {
    message: 'region must be an ISO2 country code or ALL',
  })
  region?: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  validFrom: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.999Z' })
  @IsDateString()
  validUntil: string;

  @ApiProperty({ enum: StoreAdActionTypeEnum })
  @IsEnum(StoreAdActionTypeEnum)
  actionType: StoreAdActionTypeEnum;

  @ApiPropertyOptional({ description: 'Obligatoire si actionType = PRODUCT' })
  @ValidateIf((o) => o.actionType === StoreAdActionTypeEnum.PRODUCT)
  @IsNotEmpty()
  @IsMongoId()
  productId?: string;

  @ApiPropertyOptional({
    description: 'Obligatoire si actionType = EXCLUSIVE_OFFER',
  })
  @ValidateIf(
    (o) =>
      String(o.actionType ?? '') === StoreAdActionTypeEnum.EXCLUSIVE_OFFER,
  )
  @IsNotEmpty()
  @IsMongoId()
  marketingOfferListingId?: string;

  @ApiPropertyOptional({
    description: 'Obligatoire si actionType = BUNDLE',
  })
  @ValidateIf(
    (o) => String(o.actionType ?? '') === StoreAdActionTypeEnum.BUNDLE,
  )
  @IsNotEmpty()
  @IsMongoId()
  productBundleId?: string;

  @ApiPropertyOptional({
    description:
      'Obligatoire si actionType = WHATSAPP, CALL, EMAIL ou WEBSITE (numéro, e-mail ou URL).',
  })
  @ValidateIf((o) => isAdLinkActionType(o.actionType))
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  actionTarget?: string;

  @ApiPropertyOptional({
    description: 'Audience totale ciblée (estimation de coûts).',
    example: 5000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  audienceTotal?: number;

  @ApiPropertyOptional({ type: NotificationAddonDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationAddonDto)
  notificationAddon?: NotificationAddonDto;
}

export class PatchAdManagementDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  actionText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Région ISO2, ou ALL pour toutes les régions (bannière globale).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  @Matches(/^(ALL|[A-Za-z]{2})$/i, {
    message: 'region must be an ISO2 country code or ALL',
  })
  region?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ enum: StoreAdActionTypeEnum })
  @IsOptional()
  @IsEnum(StoreAdActionTypeEnum)
  actionType?: StoreAdActionTypeEnum;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.actionType === StoreAdActionTypeEnum.PRODUCT)
  @IsOptional()
  @IsMongoId()
  productId?: string | null;

  @ApiPropertyOptional({
    description: 'Listing offre exclusive (actionType = EXCLUSIVE_OFFER).',
  })
  @ValidateIf(
    (o) =>
      String(o.actionType ?? '') === StoreAdActionTypeEnum.EXCLUSIVE_OFFER,
  )
  @IsOptional()
  @IsMongoId()
  marketingOfferListingId?: string | null;

  @ApiPropertyOptional({
    description: 'Bundle multi-produit (actionType = BUNDLE).',
  })
  @ValidateIf(
    (o) => String(o.actionType ?? '') === StoreAdActionTypeEnum.BUNDLE,
  )
  @IsOptional()
  @IsMongoId()
  productBundleId?: string | null;

  @ApiPropertyOptional({
    description:
      'Cible pour WHATSAPP / CALL / EMAIL / WEBSITE. Vide pour retirer (si le type le permet).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  actionTarget?: string | null;

  @ApiPropertyOptional({ description: 'Audience totale ciblée' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  audienceTotal?: number | null;

  @ApiPropertyOptional({ type: NotificationAddonDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationAddonDto)
  notificationAddon?: NotificationAddonDto;
}

/** Bannière pub : JSON + base64 — fiable quand multipart est tronqué (Firebase / CF / proxys). */
export class AdBannerImageJsonDto {
  @ApiProperty({
    description: 'Image en base64 (pur ou préfixe data:image/...;base64,)',
  })
  @IsNotEmpty()
  @IsString()
  imageBase64: string;

  @ApiPropertyOptional({ example: 'banniere.webp' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  filename?: string;
}

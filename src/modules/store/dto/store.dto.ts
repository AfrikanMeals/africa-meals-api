import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoreDeliveryAssignmentModeEnum, MealPreOrderCatalogScopeEnum } from '@schemas/store.schema';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class StoreShippingZoneDto {
  @ApiProperty({
    description: 'Distance minimale (km)',
    example: 0,
    type: Number,
  })
  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  minDistance: number;

  @ApiProperty({
    description: 'Distance maximale (km)',
    example: 10,
    type: Number,
  })
  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  maxDistance: number;

  @ApiProperty({
    description: 'Prix de livraison (unité)',
    example: 5.99,
    type: Number,
  })
  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  price: number;
}

export class CreateStoreDto {
  @ApiProperty({ example: 'Le Bon Resto' })
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Cuisine africaine traditionnelle' })
  @IsNotEmpty()
  bio: string;

  @ApiPropertyOptional({
    description: 'Type d’établissement (slug configuré, optionnel)',
    example: 'RESTAURANT',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? undefined : value,
  )
  @IsString()
  @MaxLength(64)
  businessType?: string;

  @ApiProperty({ format: 'email', example: 'contact@store.com' })
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({
    description:
      'Région enregistrée (ISO 3166-1 alpha-2) pour taxes et devise — distincte de l’adresse physique.',
    example: 'CM',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value == null || value === ''
      ? undefined
      : String(value).trim().toUpperCase(),
  )
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  region?: string;

  @ApiProperty({
    description: 'Livraison disponible',
    example: true,
    type: Boolean,
  })
  @IsNotEmpty()
  @IsBoolean()
  supportsShipping: boolean;

  @ApiPropertyOptional({
    description:
      'Autorise la pré-commande de repas (date/heure ultérieure). Indépendant de la livraison.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  acceptsMealPreOrders?: boolean;

  @ApiPropertyOptional({
    enum: MealPreOrderCatalogScopeEnum,
    description:
      'Plats proposés en pré-commande : menu du jour (DAILY_MENU) ou catalogue complet (CATALOG).',
    default: MealPreOrderCatalogScopeEnum.DAILY_MENU,
  })
  @IsOptional()
  @IsEnum(MealPreOrderCatalogScopeEnum)
  mealPreOrderCatalogScope?: MealPreOrderCatalogScopeEnum;

  @ApiPropertyOptional({
    description:
      'Autorise le paiement à la collecte pour les commandes à emporter (pickup).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  acceptsPickupPayOnDelivery?: boolean;

  @ApiPropertyOptional({
    description:
      'Le restaurant gère ses propres livreurs (invitations, assignation).',
  })
  @IsOptional()
  @IsBoolean()
  vendorManagesDeliveryDrivers?: boolean;

  @ApiPropertyOptional({
    enum: StoreDeliveryAssignmentModeEnum,
    description: 'AUTO = self-assign livreurs ; MANUAL = assignation vendeur.',
    default: StoreDeliveryAssignmentModeEnum.AUTO,
  })
  @IsOptional()
  @IsEnum(StoreDeliveryAssignmentModeEnum)
  deliveryAssignmentMode?: StoreDeliveryAssignmentModeEnum;

  @ApiProperty({
    description: 'Téléphone international (validé selon le pays du restaurant)',
    example: '+14165551234',
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  phoneNumber: string;

  @ApiProperty({
    type: () => CreateAddressDto,
    description: 'Adresse du magasin',
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  address: CreateAddressDto;

  @ApiPropertyOptional({
    type: () => [StoreShippingZoneDto],
    description:
      'Zones historiques (optionnel). Les frais de livraison sont gérés par la plateforme ; laisser [] si livraison activée sans zones boutique.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreShippingZoneDto)
  @ValidateIf((o) => (o.shippingZones?.length ?? 0) > 0)
  @ArrayMinSize(1)
  shippingZones?: StoreShippingZoneDto[];
}

export class DailyMenuComplementAvailabilityDto {
  @ApiProperty({ description: 'Index du groupe de compléments sur le produit' })
  @IsInt()
  @Min(0)
  groupIndex: number;

  @ApiProperty({
    type: [Number],
    description: 'Indexes des options disponibles pour ce jour',
  })
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  optionIndexes: number[];
}

export class DailyMenuAddonsAvailabilityDto {
  @ApiPropertyOptional({
    type: [Number],
    description:
      'Variantes proposées ce jour (indexes). Absent = toutes les variantes du produit.',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  variantIndexes?: number[];

  @ApiPropertyOptional({
    type: () => [DailyMenuComplementAvailabilityDto],
    description:
      'Compléments disponibles par groupe. Groupe absent = toutes les options du groupe.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyMenuComplementAvailabilityDto)
  complements?: DailyMenuComplementAvailabilityDto[];

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Suppléments proposés ce jour (indexes). Absent = tous les suppléments du produit.',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  supplementIndexes?: number[];
}

export class DailyMenuItemDto {
  @ApiProperty({
    description: 'Identifiant du plat (produit) dans le catalogue',
  })
  @IsNotEmpty()
  @IsString()
  productId: string;

  @ApiProperty({
    description:
      'Si true, le plat reste disponible sans limite de portions pour ce jour (côté menu du jour).',
  })
  @IsBoolean()
  stockUnlimited: boolean;

  @ApiPropertyOptional({
    description:
      'Portions restantes pour ce jour (obligatoire si stockUnlimited = false). À 0 le plat est indisponible sur l’app.',
    minimum: 0,
    type: Number,
  })
  @ValidateIf((o) => !o.stockUnlimited)
  @IsInt()
  @Min(0)
  stockRemaining?: number;

  @ApiPropertyOptional({
    type: () => DailyMenuAddonsAvailabilityDto,
    description:
      'Variantes, compléments et suppléments disponibles pour ce plat ce jour-là.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DailyMenuAddonsAvailabilityDto)
  addonsAvailability?: DailyMenuAddonsAvailabilityDto;
}

export class DailyMenuSlotDto {
  @ApiProperty({
    description: '0 = dimanche … 6 = samedi (comme Date.getDay())',
    minimum: 0,
    maximum: 6,
  })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Ancien format (IDs seuls). Utilisé seulement si `items` est absent ; chaque plat est alors traité comme illimité.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];

  @ApiPropertyOptional({
    type: () => [DailyMenuItemDto],
    description:
      'Plats du jour avec stock illimité ou nombre de portions restantes.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyMenuItemDto)
  items?: DailyMenuItemDto[];
}

export class PatchDailyMenuDto {
  @ApiProperty({ type: [DailyMenuSlotDto] })
  @ValidateNested({ each: true })
  @Type(() => DailyMenuSlotDto)
  @IsArray()
  slots: DailyMenuSlotDto[];
}

/** Mise à jour des zones de livraison (tous statuts sauf INACTIVE). */
export class PatchVendorShippingZonesDto {
  @ApiProperty({ description: 'Livraison assurée par le restaurant' })
  @IsBoolean()
  supportsShipping: boolean;

  @ApiPropertyOptional({
    description: 'Flotte livreurs gérée par le restaurant.',
  })
  @IsOptional()
  @IsBoolean()
  vendorManagesDeliveryDrivers?: boolean;

  @ApiPropertyOptional({
    enum: StoreDeliveryAssignmentModeEnum,
    description: 'Mode d’assignation si flotte propre active.',
  })
  @IsOptional()
  @IsEnum(StoreDeliveryAssignmentModeEnum)
  deliveryAssignmentMode?: StoreDeliveryAssignmentModeEnum;

  @ApiPropertyOptional({
    description:
      'Autorise la pré-commande de repas. Nécessite une formule incluant cette option.',
  })
  @IsOptional()
  @IsBoolean()
  acceptsMealPreOrders?: boolean;

  @ApiPropertyOptional({
    enum: MealPreOrderCatalogScopeEnum,
    description:
      'Plats proposés en pré-commande : menu du jour (DAILY_MENU) ou catalogue complet (CATALOG).',
    default: MealPreOrderCatalogScopeEnum.DAILY_MENU,
  })
  @IsOptional()
  @IsEnum(MealPreOrderCatalogScopeEnum)
  mealPreOrderCatalogScope?: MealPreOrderCatalogScopeEnum;

  @ApiPropertyOptional({
    description:
      'Autorise le paiement à la collecte (pickup). Nécessite une formule incluant cette option.',
  })
  @IsOptional()
  @IsBoolean()
  acceptsPickupPayOnDelivery?: boolean;

  @ApiPropertyOptional({
    type: () => [StoreShippingZoneDto],
    description:
      'Zones boutique (optionnel). Si vide alors supportsShipping = true, les frais restent ceux de la plateforme.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreShippingZoneDto)
  shippingZones?: StoreShippingZoneDto[];
}

/** Logo boutique : évite multipart (souvent cassé derrière Cloud Functions / certains proxys). */
export class StoreProfileImageJsonDto {
  @ApiProperty({
    description: 'Image en base64 (pur ou préfixe data:image/...;base64,)',
  })
  @IsNotEmpty()
  @IsString()
  imageBase64: string;

  @ApiPropertyOptional({ example: 'logo.png' })
  @IsOptional()
  @IsString()
  filename?: string;
}

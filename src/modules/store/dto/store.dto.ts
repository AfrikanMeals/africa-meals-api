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

export class StoreWorkingHoursSlotDto {
  @ApiProperty({ example: '09:00', description: 'Heure d’ouverture (HH:mm, 24 h)' })
  @IsString()
  @IsNotEmpty()
  open: string;

  @ApiProperty({ example: '22:00', description: 'Heure de fermeture (HH:mm, 24 h)' })
  @IsString()
  @IsNotEmpty()
  close: string;
}

export class StoreWorkingHoursDayDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = dimanche … 6 = samedi' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  closed?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  open24h?: boolean;

  @ApiPropertyOptional({ type: () => [StoreWorkingHoursSlotDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreWorkingHoursSlotDto)
  slots?: StoreWorkingHoursSlotDto[];
}

export class StoreWorkingHoursDto {
  @ApiPropertyOptional({
    default: true,
    description: 'Si faux, aucune restriction horaire (toujours ouvert).',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: () => [StoreWorkingHoursDayDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreWorkingHoursDayDto)
  schedule?: StoreWorkingHoursDayDto[];
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
      'Pré-sélectionne le paiement cash au retrait pour les commandes pickup (si acceptsPickupPayOnDelivery).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  defaultPickupPayOnPickup?: boolean;

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

  @ApiPropertyOptional({
    description: 'Fuseau horaire IANA (ex. Africa/Douala).',
    example: 'Africa/Douala',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value == null || value === '' ? undefined : String(value).trim(),
  )
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ type: () => StoreWorkingHoursDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StoreWorkingHoursDto)
  workingHours?: StoreWorkingHoursDto;
}

export enum CommissionRetrieveStrategyDto {
  ON_PAYOUT = 'on_payout',
  ADD_TO_PRICE = 'add_to_price',
}

export enum CommissionPriceActionDto {
  KEEP = 'keep',
  RESET = 'reset',
}

/** Stratégie de récupération de la commission plateforme (barème plan). */
export class PatchVendorCommissionStrategyDto {
  @ApiProperty({
    enum: CommissionRetrieveStrategyDto,
    description:
      'on_payout = commission au transfer ; add_to_price = commission ajoutée au prix client',
  })
  @IsEnum(CommissionRetrieveStrategyDto)
  strategy: CommissionRetrieveStrategyDto;

  @ApiProperty({
    enum: CommissionPriceActionDto,
    description:
      'keep = conserver les prix saisis ; reset = recalculer pour garder le prix client stable',
  })
  @IsEnum(CommissionPriceActionDto)
  priceAction: CommissionPriceActionDto;
}

/**
 * Recalcule les prix catalogue saisis sans changer la stratégie boutique.
 * Utile si les prix ont été saisis comme prix client alors que la boutique
 * est en `add_to_price` (double majoration à l’affichage).
 */
export enum CommissionCatalogAdjustModeDto {
  /** Prix DB = prix client → convertir en net vendeur (retire la commission). */
  ASSUME_CUSTOMER_PRICES = 'assume_customer_prices',
  /** Prix DB = net vendeur → stocker le prix client (rare). */
  ASSUME_VENDOR_NET = 'assume_vendor_net',
}

export class AdjustVendorCommissionCatalogPricesDto {
  @ApiProperty({
    enum: CommissionCatalogAdjustModeDto,
    description:
      'assume_customer_prices = retirer la commission des prix saisis ; assume_vendor_net = majorer les prix saisis',
  })
  @IsEnum(CommissionCatalogAdjustModeDto)
  mode: CommissionCatalogAdjustModeDto;

  @ApiPropertyOptional({
    description:
      'Inclure aussi les plats/boissons avec stratégie article explicite add_to_price (défaut true).',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === false || value === 'false' || value === 0 || value === '0') {
      return false;
    }
    if (value === true || value === 'true' || value === 1 || value === '1') {
      return true;
    }
    return true;
  })
  includeItemOverrides?: boolean;
}

/** Horaires d’ouverture et fuseau horaire (tous statuts sauf INACTIVE). */
export class PatchVendorWorkingHoursDto {
  @ApiPropertyOptional({
    description: 'Fuseau horaire IANA (ex. Africa/Douala).',
    example: 'Africa/Douala',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value == null || value === '' ? undefined : String(value).trim(),
  )
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({ type: () => StoreWorkingHoursDto })
  @ValidateNested()
  @Type(() => StoreWorkingHoursDto)
  workingHours: StoreWorkingHoursDto;
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

/** Boisson du menu du jour — stock par jour, sans addons (les boissons n'ont pas de variantes). */
export class DailyMenuDrinkItemDto {
  @ApiProperty({ description: 'ID de la boisson dans le catalogue' })
  @IsNotEmpty()
  @IsString()
  drinkId: string;

  @ApiProperty({
    description:
      'Si true, la boisson reste disponible sans limite de portions pour ce jour.',
  })
  @IsBoolean()
  stockUnlimited: boolean;

  @ApiPropertyOptional({
    description:
      'Portions restantes (obligatoire si stockUnlimited = false). À 0 la boisson est indisponible.',
    minimum: 0,
  })
  @ValidateIf((o) => !o.stockUnlimited)
  @IsInt()
  @Min(0)
  stockRemaining?: number;
}

/** Bundle du menu du jour — stock par jour, sans addons (le bundle définit déjà ses items). */
export class DailyMenuBundleItemDto {
  @ApiProperty({ description: 'ID du bundle produit' })
  @IsNotEmpty()
  @IsString()
  bundleId: string;

  @ApiProperty({
    description:
      'Si true, le bundle reste disponible sans limite pour ce jour.',
  })
  @IsBoolean()
  stockUnlimited: boolean;

  @ApiPropertyOptional({
    description:
      'Portions restantes (obligatoire si stockUnlimited = false). À 0 le bundle est indisponible.',
    minimum: 0,
  })
  @ValidateIf((o) => !o.stockUnlimited)
  @IsInt()
  @Min(0)
  stockRemaining?: number;
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

  @ApiPropertyOptional({
    type: () => [DailyMenuDrinkItemDto],
    description: 'Boissons du jour avec gestion de stock.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyMenuDrinkItemDto)
  drinkItems?: DailyMenuDrinkItemDto[];

  @ApiPropertyOptional({
    type: () => [DailyMenuBundleItemDto],
    description: 'Bundles du jour avec gestion de stock.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyMenuBundleItemDto)
  bundleItems?: DailyMenuBundleItemDto[];
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
    description:
      'Pré-sélectionne le paiement cash au retrait (pickup) si acceptsPickupPayOnDelivery est actif.',
  })
  @IsOptional()
  @IsBoolean()
  defaultPickupPayOnPickup?: boolean;

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

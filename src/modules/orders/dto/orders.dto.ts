import { OrderStatusEnum } from '@schemas/order.schema';
import { FieldSelectionQueryDto } from '@common/field-selection/field-selection-query.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  CLIENT_ORDER_CANCEL_REASON_CODES,
  ORDER_CANCEL_REASON_OTHER,
  VENDOR_ORDER_CANCEL_REASON_CODES,
} from '../order-cancel-reasons';

export class FilterOrdersDto extends FieldSelectionQueryDto {
  @ApiPropertyOptional({ enum: OrderStatusEnum })
  @IsOptional()
  @IsEnum(OrderStatusEnum)
  status?: OrderStatusEnum;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439011' })
  @IsOptional()
  storeId?: string;

  @ApiPropertyOptional({
    description:
      'Nombre max de commandes (tri par date décroissante). Défaut **80** si absent (liste mobile). Max 200.',
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Pagination : nombre de commandes à sauter (tri `createdAt` desc). Max 10 000.',
    minimum: 0,
    maximum: 10_000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  skip?: number;

  @ApiPropertyOptional({
    description:
      'Filtre sur le nom de la boutique (recherche insensible à la casse, préfixe libre).',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    description:
      "Force le scope client (commandes de l'utilisateur connecté) même pour ADMIN/VENDOR/DELIVERY.",
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    const s = String(value ?? '')
      .trim()
      .toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  })
  asCustomer?: boolean;

  @ApiPropertyOptional({
    description: 'Filtre pré-commandes repas planifiées uniquement.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    const s = String(value ?? '')
      .trim()
      .toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  })
  isPreOrder?: boolean;

  @ApiPropertyOptional({
    description:
      'Pré-commandes planifiées après aujourd’hui (UTC, début de journée).',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    const s = String(value ?? '')
      .trim()
      .toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  })
  preOrderFuture?: boolean;

  @ApiPropertyOptional({
    description:
      'Exclut les pré-commandes dont la date planifiée est strictement future (liste commandes actives).',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    const s = String(value ?? '')
      .trim()
      .toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  })
  excludeFuturePreOrders?: boolean;

  @ApiPropertyOptional({ enum: ['createdAt', 'scheduledAt'] })
  @IsOptional()
  @IsIn(['createdAt', 'scheduledAt'])
  sortBy?: 'createdAt' | 'scheduledAt';

  @ApiPropertyOptional({
    description:
      'Commandes que j’ai offertes (`paidBy` = moi, destinataire ≠ moi). Scope client.',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    const s = String(value ?? '')
      .trim()
      .toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  })
  giftedByMe?: boolean;
}

export class ConfirmPickupDto {
  @ApiProperty({
    description: 'Code retrait affiché au client (6 caractères).',
    example: 'A1B0C2',
    minLength: 4,
    maxLength: 12,
  })
  @IsString()
  @MinLength(4)
  @MaxLength(12)
  code!: string;

  @ApiPropertyOptional({
    description:
      'Montant cash encaissé (devise commande). Par défaut = total dû. Commandes payOnPickup uniquement.',
    example: 42.5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  collectedAmount?: number;
}

export class PatchPreOrderCustomerNoteDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  customerNote!: string;
}

export class CreateRefundRequestDto {
  @ApiProperty({
    description: 'Code motif prédéfini (liste client).',
    enum: CLIENT_ORDER_CANCEL_REASON_CODES,
    example: 'changed_mind',
  })
  @IsString()
  @IsIn([...CLIENT_ORDER_CANCEL_REASON_CODES])
  reasonCode!: string;

  @ApiPropertyOptional({
    description:
      'Précision obligatoire si `reasonCode` = `other` (min. 10 caractères). Optionnel sinon.',
    maxLength: 4000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @ValidateIf((o) => o.reasonCode === ORDER_CANCEL_REASON_OTHER)
  @MinLength(10)
  details?: string;
}

export class RejectOrderDto {
  @ApiProperty({
    description: 'Code motif prédéfini (liste vendeur / admin).',
    enum: VENDOR_ORDER_CANCEL_REASON_CODES,
    example: 'out_of_stock',
  })
  @IsString()
  @IsIn([...VENDOR_ORDER_CANCEL_REASON_CODES])
  reasonCode!: string;

  @ApiPropertyOptional({
    description:
      'Précision obligatoire si `reasonCode` = `other` (min. 10 caractères).',
    maxLength: 4000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @ValidateIf((o) => o.reasonCode === ORDER_CANCEL_REASON_OTHER)
  @MinLength(10)
  details?: string;
}

export class VendorCourierLocationDto {
  @ApiProperty({ example: 14.7167 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: -17.4677 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

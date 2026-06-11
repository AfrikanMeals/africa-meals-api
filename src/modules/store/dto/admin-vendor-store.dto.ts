import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoreStatusEnum } from '@schemas/store.schema';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CreateStoreDto } from './store.dto';

/** Changement de statut boutique par un administrateur (approbation / suspension). */
export class AdminVendorStoreStatusDto {
  @ApiProperty({
    enum: [StoreStatusEnum.ACTIVE, StoreStatusEnum.INACTIVE],
    example: StoreStatusEnum.ACTIVE,
  })
  @IsIn([StoreStatusEnum.ACTIVE, StoreStatusEnum.INACTIVE])
  status: StoreStatusEnum.ACTIVE | StoreStatusEnum.INACTIVE;
}

/** Édition admin de la fiche onboarding d’une boutique vendeur. */
export class AdminPatchVendorStoreDto extends CreateStoreDto {
  @ApiPropertyOptional({
    description:
      'Devise boutique (ISO 4217). Admin : modifiable indépendamment du pays.',
    example: 'XAF',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    value == null || value === ''
      ? undefined
      : String(value).trim().toUpperCase(),
  )
  @Matches(/^[A-Z]{3}$/, { message: 'invalid_currency' })
  currency?: string;

  @ApiPropertyOptional({
    description: 'Note interne visible par le vendeur dans son fil de dossier',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;

  @ApiPropertyOptional({
    description: 'La boutique accepte les commandes clients.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  acceptsOrders?: boolean;
}

/** Demande de corrections sur le dossier vendeur (statut REVISION). */
export class AdminVendorRequestRevisionDto {
  @ApiProperty({
    description: 'Message expliquant les corrections attendues',
    minLength: 10,
    maxLength: 2000,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message: string;
}

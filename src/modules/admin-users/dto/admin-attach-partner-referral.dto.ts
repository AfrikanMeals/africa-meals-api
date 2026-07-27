import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body admin — lier un Client / Vendeur / Livreur à un Partner via code referral.
 */
export class AdminAttachPartnerReferralDto {
  @ApiProperty({
    description: 'Code referral Partner (6 caractères A–Z / 0–9)',
    example: 'AB12CD',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  @Matches(/^[A-Za-z0-9]{6}$/, {
    message: 'partner_referral_code_invalid',
  })
  // Normalise tôt pour unicité / lookup (même contrat ensure-referral).
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  referralCode!: string;

  @ApiPropertyOptional({
    description:
      'Si true, écrase un referredByPartner déjà défini (correction ops)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

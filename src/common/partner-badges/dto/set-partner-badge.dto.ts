import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartnerBadgeCode } from '@common/partner-badges/partner-badge.constants';
import { IsIn, ValidateIf } from 'class-validator';

export class SetPartnerBadgeDto {
  @ApiPropertyOptional({
    enum: PartnerBadgeCode,
    nullable: true,
    description: 'Badge partenaire (null pour retirer).',
  })
  @ValidateIf((_o, value) => value != null && value !== '')
  @IsIn(Object.values(PartnerBadgeCode))
  badgeCode?: PartnerBadgeCode | null;
}

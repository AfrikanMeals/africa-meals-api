import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class RefundFeeOverrideDto {
  @ApiPropertyOptional({
    description:
      'Frais plateforme retenus sur le remboursement (centimes). 0 = remboursement intégral au client.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  platformRefundFeeCents?: number;
}

export class RefundProcessDto extends RefundFeeOverrideDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

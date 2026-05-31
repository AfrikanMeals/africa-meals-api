import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateAdPricingDto {
  @ApiPropertyOptional({ example: 'CAD' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiProperty({
    description: 'Coût par 1000 impressions (CPM) en devise sélectionnée.',
    example: 7.5,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cpmCad?: number;

  @ApiProperty({
    description: 'Coût par clic (CPC) en devise sélectionnée.',
    example: 0.35,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cpcCad?: number;

  @ApiPropertyOptional({
    description: 'Coût campagne par 1000 impressions (CPM campagne).',
    example: 6.5,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  campaignCpmCad?: number;

  @ApiPropertyOptional({
    description: 'Coût campagne par clic (CPC campagne).',
    example: 0.25,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  campaignCpcCad?: number;

  @ApiPropertyOptional({
    description: 'Coût spécifique pour le clic sur la carte action finale.',
    example: 0.6,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  campaignActionCad?: number;

  @ApiPropertyOptional({
    description: 'Budget minimum conseillé (affichage admin).',
    example: 25,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumBudgetCad?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CollectVendorAnalyticsDto {
  @ApiProperty({
    description: 'Identifiant de la boutique associée à l’événement',
    example: '665f0f3796d5d5480f2a4f9c',
  })
  @IsMongoId()
  storeId: string;

  @ApiPropertyOptional({
    description: 'Durée en secondes (session boutique)',
    example: 42,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSec?: number;

  @ApiPropertyOptional({
    description: 'Type d’engagement (tab, add_to_cart, etc.)',
    example: 'tab_drinks',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  engagement?: string;
}

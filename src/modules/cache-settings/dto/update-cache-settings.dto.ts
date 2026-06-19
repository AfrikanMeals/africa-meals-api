import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateCacheSettingsDto {
  @ApiProperty({ example: 90_000, description: 'TTL catalogue public (ms).' })
  @IsInt()
  @Min(5_000)
  @Max(3_600_000)
  publicCatalogTtlMs: number;

  @ApiProperty({ example: 25_000, description: 'TTL listes favoris (ms).' })
  @IsInt()
  @Min(5_000)
  @Max(600_000)
  favoritesTtlMs: number;

  @ApiProperty({ example: 120_000, description: 'TTL catégories produits (ms).' })
  @IsInt()
  @Min(5_000)
  @Max(3_600_000)
  productCategoriesTtlMs: number;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RoutingCacheSettingsDto {
  @ApiPropertyOptional({
    description: 'TTL itinéraire statique boutique→client (secondes)',
    minimum: 60,
    maximum: 3600,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(3600)
  staticTtlSeconds?: number;

  @ApiPropertyOptional({
    description: 'TTL itinéraire dynamique GPS→cible (secondes)',
    minimum: 10,
    maximum: 300,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(300)
  dynamicTtlSeconds?: number;

  @ApiPropertyOptional({
    description:
      'Re-calcul Directions si l’origine GPS a bougé de plus de N mètres',
    minimum: 25,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(25)
  @Max(500)
  agentMoveInvalidateMeters?: number;

  @ApiPropertyOptional({
    description: 'Demander des routes alternatives (coût Directions plus élevé)',
  })
  @IsOptional()
  @IsBoolean()
  requestAlternatives?: boolean;

  @ApiPropertyOptional({
    description: 'TTL cache admin suivi live (millisecondes)',
    minimum: 30000,
    maximum: 600000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30_000)
  @Max(600_000)
  adminTtlMs?: number;

  @ApiPropertyOptional({
    description: 'Filtre distance GPS marqueur (précision navigation), mètres',
    minimum: 1,
    maximum: 25,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  gpsMarkerDistanceFilterMeters?: number;

  @ApiPropertyOptional({
    description: 'Debounce refresh itinéraire après tick GPS (ms)',
    minimum: 300,
    maximum: 5000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(300)
  @Max(5000)
  routeRefreshDebounceMs?: number;
}

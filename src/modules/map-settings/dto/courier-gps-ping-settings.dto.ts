import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Ping GPS temps réel livreur (admin Paramètres → Carte). */
export class CourierGpsPingSettingsDto {
  @ApiPropertyOptional({
    description:
      'OFF = plus de POST /delivery-agent/location (GEO périme ~120 s). Pin local inchangé.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Intervalle course active (ms)',
    minimum: 1000,
    maximum: 10000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(10_000)
  intervalActiveMs?: number;

  @ApiPropertyOptional({
    description: 'Intervalle hors course (ms)',
    minimum: 5000,
    maximum: 60000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5_000)
  @Max(60_000)
  intervalIdleMs?: number;

  @ApiPropertyOptional({
    enum: ['performant', 'optimal', 'precise', 'custom'],
    description: 'Preset admin (custom si champs retouchés).',
  })
  @IsOptional()
  @IsIn(['performant', 'optimal', 'precise', 'custom'])
  profile?: 'performant' | 'optimal' | 'precise' | 'custom';

  @ApiPropertyOptional({
    description: 'Buffer GPS local + POST trail (streaming coords).',
  })
  @IsOptional()
  @IsBoolean()
  streamCoordinates?: boolean;

  @ApiPropertyOptional({
    description: 'Cadence d’échantillonnage locale (ms)',
    minimum: 250,
    maximum: 2000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(250)
  @Max(2_000)
  streamSampleMs?: number;

  @ApiPropertyOptional({
    description: 'Max points trail par POST',
    minimum: 2,
    maximum: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(12)
  streamMaxPoints?: number;

  @ApiPropertyOptional({
    description: '0 = pas de filtre précision GPS (m)',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxAccuracyMeters?: number;

  @ApiPropertyOptional({
    description:
      'Piggyback présence livreur + statut commande sur fleet:location / order:tracking.',
  })
  @IsOptional()
  @IsBoolean()
  syncStatusAndState?: boolean;
}

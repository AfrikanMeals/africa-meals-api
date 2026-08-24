import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
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
}

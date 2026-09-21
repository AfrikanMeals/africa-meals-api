import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Point intermédiaire du stream GPS (entre deux POST tip). */
export class CourierGpsTrailPointDto {
  @ApiProperty({ example: 48.42 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: -71.05 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  recordedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  headingDegrees?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(80)
  speedMps?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  accuracyMeters?: number;
}

/**
 * Télémétrie GPS livreur — tip realtime :
 * Lat/Lng/Heading/Speed/Battery/Timestamp → Backend → Redis GEO → WS.
 * `trail` = streaming coords (preset admin Precise / Optimal / Performant).
 */
export class DeliveryAgentLocationDto {
  @ApiProperty({ example: 48.42 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: -71.05 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  /** Vitesse instantanée (m/s) — Traffic Engine + marqueur client. */
  @ApiPropertyOptional({ example: 8.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(80)
  speedMps?: number;

  /** Cap GPS / boussole (0–360°). */
  @ApiPropertyOptional({ example: 135 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  headingDegrees?: number;

  /** Niveau batterie appareil (0–100). */
  @ApiPropertyOptional({ example: 72 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  batteryPercent?: number;

  /** Horodatage appareil (ISO-8601) — source de vérité hors latence réseau. */
  @ApiPropertyOptional({ example: '2026-07-14T00:10:00.000Z' })
  @IsOptional()
  @IsISO8601()
  recordedAt?: string;

  /** Précision horizontale appareil (m) — filtre admin `maxAccuracyMeters`. */
  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  accuracyMeters?: number;

  /** Échantillons GPS entre deux POST (streaming). */
  @ApiPropertyOptional({ type: [CourierGpsTrailPointDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CourierGpsTrailPointDto)
  trail?: CourierGpsTrailPointDto[];
}

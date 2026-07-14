import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

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

  /** Vitesse instantanée (m/s) — télémétrie Traffic Engine flotte. */
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
}

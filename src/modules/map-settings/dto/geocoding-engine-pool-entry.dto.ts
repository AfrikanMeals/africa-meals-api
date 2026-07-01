import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';

const GEOCODING_ENGINES = ['mapbox', 'google', 'osm'] as const;

export class GeocodingEnginePoolEntryDto {
  @ApiProperty({ enum: GEOCODING_ENGINES })
  @IsString()
  @IsIn(GEOCODING_ENGINES)
  engine: string;

  @ApiProperty({ minimum: 0, maximum: 10_000 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  weight: number;
}

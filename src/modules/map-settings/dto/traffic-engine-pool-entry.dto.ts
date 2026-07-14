import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import { KNOWN_TRAFFIC_ENGINES } from '@common/traffic-engine-pool.util';

const TRAFFIC_ENGINES = [...KNOWN_TRAFFIC_ENGINES] as const;

export class TrafficEnginePoolEntryDto {
  @ApiProperty({ enum: TRAFFIC_ENGINES })
  @IsString()
  @IsIn(TRAFFIC_ENGINES)
  engine: string;

  @ApiProperty({ minimum: 0, maximum: 10_000 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  weight: number;
}

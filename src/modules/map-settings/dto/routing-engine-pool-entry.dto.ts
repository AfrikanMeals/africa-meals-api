import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import { KNOWN_ROUTING_ENGINES } from '@common/routing-engine-pool.util';

export class RoutingEnginePoolEntryDto {
  @ApiProperty({ enum: KNOWN_ROUTING_ENGINES, example: 'osrm' })
  @IsString()
  @IsIn([...KNOWN_ROUTING_ENGINES])
  engine: string;

  @ApiProperty({ example: 100, minimum: 0, maximum: 10000 })
  @IsInt()
  @Min(0)
  @Max(10000)
  weight: number;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

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
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePenaltyCustomMotifDto {
  @ApiProperty({ example: 'Retard grave répété' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  labelFr: string;
}

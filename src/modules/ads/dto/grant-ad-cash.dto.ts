import { ApiProperty } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class GrantAdCashDto {
  @ApiProperty({ example: 50, description: 'Unités Ad Cash à accorder' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ required: false, example: 'Promotion lancement' })
  @IsOptional()
  @IsString()
  @Trim()
  note?: string;
}

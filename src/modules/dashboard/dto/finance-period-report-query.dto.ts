import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class FinancePeriodReportQueryDto {
  @ApiProperty({
    example: '2026-05-01',
    description: 'Début inclusif (YYYY-MM-DD)',
  })
  @IsDateString()
  from!: string;

  @ApiProperty({
    example: '2026-05-19',
    description: 'Fin inclusive (YYYY-MM-DD)',
  })
  @IsDateString()
  to!: string;
}

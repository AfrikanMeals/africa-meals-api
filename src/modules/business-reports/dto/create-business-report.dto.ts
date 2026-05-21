import { BusinessStoreReportCategoryEnum } from '@schemas/business-store-report.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBusinessReportDto {
  @ApiProperty({
    description: 'Description du problème (visible par l’équipe Afrika Meals).',
    minLength: 10,
    maxLength: 8000,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(8000)
  details: string;

  @ApiPropertyOptional({ enum: BusinessStoreReportCategoryEnum })
  @IsOptional()
  @IsEnum(BusinessStoreReportCategoryEnum)
  category?: BusinessStoreReportCategoryEnum;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessStoreReportSeverityEnum } from '@schemas/business-store-report.schema';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateBusinessReportAdminDto {
  @ApiPropertyOptional({ enum: BusinessStoreReportSeverityEnum })
  @IsOptional()
  @IsEnum(BusinessStoreReportSeverityEnum)
  severity?: BusinessStoreReportSeverityEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

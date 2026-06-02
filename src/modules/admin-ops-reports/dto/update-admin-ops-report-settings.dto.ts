import { AdminOpsReportPeriodEnum } from '@schemas/admin-ops-report-settings.schema';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateAdminOpsReportSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(AdminOpsReportPeriodEnum)
  period?: AdminOpsReportPeriodEnum;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  sendHourLocal?: number;
}

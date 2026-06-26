import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateDatabaseSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  incrementalBackupEnabled?: boolean;

  @ApiPropertyOptional({ enum: ['hour', 'day', 'week', 'month'] })
  @IsOptional()
  @IsIn(['hour', 'day', 'week', 'month'])
  incrementalBackupIntervalUnit?: 'hour' | 'day' | 'week' | 'month';

  @ApiPropertyOptional({ minimum: 1, maximum: 720 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  incrementalBackupIntervalValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  fullBackupEnabled?: boolean;

  @ApiPropertyOptional({ enum: ['daily', 'weekly', 'monthly'] })
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  fullBackupSchedule?: 'daily' | 'weekly' | 'monthly';

  @ApiPropertyOptional({ minimum: 0, maximum: 23 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  fullBackupHourUtc?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  fullBackupDayOfWeek?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 28 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  fullBackupDayOfMonth?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  backupRetentionDays?: number;
}

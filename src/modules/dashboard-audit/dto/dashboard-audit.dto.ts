import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class DashboardAuditEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  action: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  storeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  resource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  resourceId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

export class BatchDashboardAuditEventsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DashboardAuditEventDto)
  events: DashboardAuditEventDto[];
}

export class QueryDashboardAuditEventsDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  actorType?: string;

  @IsOptional()
  @IsString()
  path?: string;

  /** `platform` = journal admin complet ; défaut = périmètre vendeur (ses actions + boutiques). */
  @IsOptional()
  @IsString()
  scope?: string;
}

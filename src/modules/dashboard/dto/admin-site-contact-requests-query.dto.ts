import { ApiPropertyOptional } from '@nestjs/swagger';
import { SiteContactRequestMailStatusEnum } from '@schemas/site-contact-request.schema';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdminSiteContactRequestsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @ApiPropertyOptional({ enum: SiteContactRequestMailStatusEnum })
  @IsOptional()
  @IsEnum(SiteContactRequestMailStatusEnum)
  mailStatus?: SiteContactRequestMailStatusEnum;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsString()
  to?: string;
}

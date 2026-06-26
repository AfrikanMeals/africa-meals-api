import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Paramètres optionnels — sans body, teste la base API actuelle. */
export class TestDatabaseConnectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  uri?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  host?: string;

  @ApiPropertyOptional({ default: 27017 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  database?: string;

  @ApiPropertyOptional({ default: 'admin' })
  @IsOptional()
  @IsString()
  authSource?: string;
}

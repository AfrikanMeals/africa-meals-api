import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class BlockCatalogModerationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  blockReason: string;
}

export class UnblockCatalogModerationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

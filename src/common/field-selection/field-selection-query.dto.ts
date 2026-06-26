import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

function trimOptional(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  return s.length > 0 ? s : undefined;
}

/** Query params partagés pour projection de champs (`fields`, `fieldsRoot`, …). */
export class FieldSelectionQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimOptional(value))
  fields?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimOptional(value))
  include?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimOptional(value))
  exclude?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimOptional(value))
  fieldsRoot?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimOptional(value))
  includeFields?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimOptional(value))
  excludeFields?: string;
}

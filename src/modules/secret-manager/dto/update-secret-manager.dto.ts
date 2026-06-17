import { SecretManagerScope } from '@schemas/secret-manager.schema';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Nom de variable d'environnement (MAJUSCULES, chiffres, underscores). */
export const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export class UpdateSecretManagerKeyDto {
  @IsString()
  @MaxLength(120)
  @Matches(ENV_VAR_NAME_PATTERN, {
    message: 'env_var_name_invalid',
  })
  envVarName: string;

  @IsOptional()
  @IsBoolean()
  dbEnabled?: boolean;

  /** Non vide = enregistrer en base ; absent = conserver la valeur actuelle. */
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  value?: string;
}

export class UpdateSecretManagerDto {
  @IsIn(['api', 'ws'])
  scope: SecretManagerScope;

  @IsOptional()
  @IsBoolean()
  managerEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSecretManagerKeyDto)
  keys?: UpdateSecretManagerKeyDto[];

  /** Supprime des clés personnalisées (non présentes dans le registre). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  removeKeys?: string[];
}

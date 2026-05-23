import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ArrayMinSize,
} from 'class-validator';

export class CreateStoreRoleDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateStoreRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class AddStoreMemberDto {
  @IsEmail()
  email: string;

  /** Un seul rôle (rétrocompatibilité). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  roleId?: string;

  /** Un ou plusieurs rôles boutique. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleIds?: string[];
}

export class UpdateStoreMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  roleId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleIds?: string[];
}

export class CreatePlatformRoleDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}

export class UpdatePlatformRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class AssignPlatformRoleDto {
  @IsOptional()
  @IsString()
  platformRoleId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platformRoleIds?: string[] | null;
}

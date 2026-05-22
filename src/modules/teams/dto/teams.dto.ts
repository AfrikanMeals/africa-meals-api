import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
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

  @IsString()
  @MinLength(1)
  roleId: string;
}

export class UpdateStoreMemberDto {
  @IsString()
  @MinLength(1)
  roleId: string;
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
}

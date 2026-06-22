import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePlatformSurfaceModulesDto {
  @IsOptional()
  @IsBoolean()
  deliveryTools?: boolean;

  @IsOptional()
  @IsBoolean()
  pickup?: boolean;

  @IsOptional()
  @IsBoolean()
  marketing?: boolean;

  @IsOptional()
  @IsBoolean()
  vendorTools?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryAgent?: boolean;

  @IsOptional()
  @IsBoolean()
  chat?: boolean;
}

export class UpdatePlatformFeatureModulesDto {
  @IsOptional()
  admin?: UpdatePlatformSurfaceModulesDto;

  @IsOptional()
  mobile?: UpdatePlatformSurfaceModulesDto;
}

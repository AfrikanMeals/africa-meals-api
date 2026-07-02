import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateUserNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailRecommendations?: boolean;

  @IsOptional()
  @IsBoolean()
  emailStoreDigest?: boolean;

  @IsOptional()
  @IsBoolean()
  emailMarketing?: boolean;
}

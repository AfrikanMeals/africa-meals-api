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

  /** Sync mobile — Notifications push. */
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  /** Sync mobile — Recevoir les alertes par e-mail. */
  @IsOptional()
  @IsBoolean()
  emailAlertsEnabled?: boolean;

  /** Sync mobile — catégorie Livraison. */
  @IsOptional()
  @IsBoolean()
  shippingDeliveryEnabled?: boolean;
}

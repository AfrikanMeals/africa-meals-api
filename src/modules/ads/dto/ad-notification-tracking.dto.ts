import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum TrackAdNotificationEventKindEnum {
  INTERACTION = 'interaction',
  CONVERSION = 'conversion',
}

export class TrackAdNotificationEventDto {
  @ApiProperty({ description: 'Identifiant de livraison (deeplink / push)' })
  @IsString()
  @MaxLength(64)
  deliveryId: string;

  @ApiProperty({ enum: TrackAdNotificationEventKindEnum })
  @IsEnum(TrackAdNotificationEventKindEnum)
  event: TrackAdNotificationEventKindEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  installId?: string;

  @ApiProperty({
    description: 'Jeton HMAC signé (paramètre `t` du lien web /ads/open)',
  })
  @IsString()
  @MaxLength(256)
  trackToken: string;
}

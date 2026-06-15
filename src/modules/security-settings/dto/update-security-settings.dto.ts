import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateSecuritySettingsDto {
  @ApiProperty({ description: 'App Check — application mobile' })
  @IsBoolean()
  appCheckMobileEnabled: boolean;

  @ApiProperty({ description: 'App Check — site vitrine Web' })
  @IsBoolean()
  appCheckWebEnabled: boolean;

  @ApiProperty({ description: 'App Check — tableau de bord admin' })
  @IsBoolean()
  appCheckAdminEnabled: boolean;

  @ApiProperty({ description: 'App Check — service WebSocket (chat)' })
  @IsBoolean()
  appCheckWebsocketEnabled: boolean;

  @ApiProperty({
    description: 'Vérification des jetons sur l’API REST principale',
  })
  @IsBoolean()
  appCheckApiEnabled: boolean;
}

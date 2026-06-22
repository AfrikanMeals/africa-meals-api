import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAuthSettingsDto {
  @ApiProperty({ description: 'Connexion Google (Firebase) — tableau de bord admin' })
  @IsBoolean()
  googleEnabledAdmin: boolean;

  @ApiProperty({ description: 'Connexion Google (Firebase) — application mobile' })
  @IsBoolean()
  googleEnabledMobile: boolean;

  @ApiProperty({ description: 'Connexion Apple (Firebase) — tableau de bord admin' })
  @IsBoolean()
  appleEnabledAdmin: boolean;

  @ApiProperty({ description: 'Connexion Apple (Firebase) — application mobile' })
  @IsBoolean()
  appleEnabledMobile: boolean;

  @ApiProperty({ description: 'Connexion Facebook (Firebase) — tableau de bord admin' })
  @IsBoolean()
  facebookEnabledAdmin: boolean;

  @ApiProperty({ description: 'Connexion Facebook (Firebase) — application mobile' })
  @IsBoolean()
  facebookEnabledMobile: boolean;

  @ApiProperty({
    description: 'E-mail de notification à chaque connexion (tableau de bord admin)',
  })
  @IsBoolean()
  loginEmailNotifyAdminEnabled: boolean;

  @ApiProperty({
    description: 'E-mail de notification à chaque connexion (application mobile)',
  })
  @IsBoolean()
  loginEmailNotifyMobileEnabled: boolean;
}

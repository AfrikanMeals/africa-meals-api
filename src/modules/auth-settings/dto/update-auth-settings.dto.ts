import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAuthSettingsDto {
  @ApiProperty({ description: 'Connexion Google (Firebase) active' })
  @IsBoolean()
  googleEnabled: boolean;

  @ApiProperty({ description: 'Connexion Apple (Firebase) active' })
  @IsBoolean()
  appleEnabled: boolean;

  @ApiProperty({ description: 'Connexion Facebook (Firebase) active' })
  @IsBoolean()
  facebookEnabled: boolean;
}

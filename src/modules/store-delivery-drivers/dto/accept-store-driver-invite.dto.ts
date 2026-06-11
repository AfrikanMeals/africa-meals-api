import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AcceptStoreDriverInviteDto {
  @ApiProperty({ description: 'Jeton d’invitation livreur (lien e-mail).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/** Données saisies par l’admin pour inviter un futur restaurant par e-mail. */
export class VendorInvitationDto {
  @ApiProperty({ example: 'Koné' })
  @IsNotEmpty()
  @Trim()
  @IsString()
  nom: string;

  @ApiProperty({ example: 'Aminata' })
  @IsNotEmpty()
  @Trim()
  @IsString()
  prenom: string;

  @ApiProperty({ example: '+14165552001' })
  @IsNotEmpty()
  @Trim()
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: 'contact@restaurant.com' })
  @IsEmail()
  @Trim()
  email: string;
}

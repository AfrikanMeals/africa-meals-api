import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

export class SendOrderEmailDebugDto {
  @ApiProperty({ description: 'ID Mongo de la commande' })
  @IsString()
  @MinLength(1)
  orderId!: string;

  @ApiProperty({ enum: ['paid', 'shipped'] })
  @IsIn(['paid', 'shipped'])
  variant!: 'paid' | 'shipped';

  @ApiProperty({
    description:
      'Destinataire du test (ex. votre Gmail personnel pour vérifier la carte Achats)',
  })
  @IsEmail()
  toEmail!: string;
}

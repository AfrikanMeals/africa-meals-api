import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class TestEmailDto {
  @ApiProperty({
    format: 'email',
    example: 'test@example.com',
    description: 'Adresse email qui recevra l’email de test',
  })
  @IsNotEmpty()
  @IsEmail()
  to: string;
}

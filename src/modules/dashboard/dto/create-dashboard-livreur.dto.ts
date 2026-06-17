import {
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateDashboardLivreurDto {
  /** Admin : obligatoire si plusieurs boutiques ciblées ; vendeur multi-boutiques : id de la boutique. */
  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nom: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  avatar: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  tel: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  zone: string;

  @IsIn([
    'À pied',
    'Vélo',
    'Tricycle',
    'Scooter',
    'Moto',
    'Voiture',
    'Fourgonnette',
  ])
  vehicule:
    | 'À pied'
    | 'Vélo'
    | 'Tricycle'
    | 'Scooter'
    | 'Moto'
    | 'Voiture'
    | 'Fourgonnette';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  immat?: string;
}

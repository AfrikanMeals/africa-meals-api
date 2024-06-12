import { Trim } from 'class-sanitizer';
import { IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class CreateProductDto {
  @IsNotEmpty()
  @Trim()
  title: string;

  @IsNotEmpty()
  @Trim()
  bio: string;

  @IsNotEmpty()
  @Trim()
  originCountry: string;

  @IsNotEmpty()
  @IsNumber()
  price: string;

  @IsOptional()
  @Trim()
  about?: string;

  @IsNotEmpty()
  @Trim()
  category: string;
}

export class CreateProductExtraDto {
  @IsNotEmpty()
  @Trim()
  title: string;

  @IsNotEmpty()
  @Trim()
  description: string;

  @IsNotEmpty()
  @IsNumber()
  price: number;

  @IsOptional()
  @Trim()
  image?: Express.Multer.File;

  @IsOptional()
  @Trim()
  profileImage?: string;
}

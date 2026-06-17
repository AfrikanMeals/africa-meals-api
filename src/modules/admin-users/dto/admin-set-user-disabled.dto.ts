import { IsBoolean } from 'class-validator';

export class AdminSetUserDisabledDto {
  @IsBoolean()
  disabled: boolean;
}

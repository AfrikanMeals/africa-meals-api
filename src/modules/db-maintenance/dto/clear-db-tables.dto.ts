import { ArrayMinSize, IsArray, IsString, Equals } from 'class-validator';
import { DB_CLEAR_CONFIRM_PHRASE } from '../db-clearable-tables';

export class ClearDbTablesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  tables!: string[];

  @IsString()
  @Equals(DB_CLEAR_CONFIRM_PHRASE)
  confirmPhrase!: string;
}

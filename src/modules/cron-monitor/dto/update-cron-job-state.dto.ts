import { IsBoolean } from 'class-validator';

export class UpdateCronJobStateDto {
  @IsBoolean()
  paused: boolean;
}

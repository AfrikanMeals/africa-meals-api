import { IsBoolean } from 'class-validator';

export class SetClientRewardProgramDto {
  @IsBoolean()
  eligible: boolean;
}

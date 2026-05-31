import { IsBoolean } from 'class-validator';

export class UpdateInfraRuntimeSettingsDto {
  @IsBoolean()
  redisManagerEnabled: boolean;

  @IsBoolean()
  mqBrokerEnabled: boolean;
}

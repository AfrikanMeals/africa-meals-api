import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const APP_CHECK_SESSION_APPS = ['android', 'ios'] as const;
export type AppCheckSessionApp = (typeof APP_CHECK_SESSION_APPS)[number];

export class CreateAppCheckSessionTokenDto {
  @ApiProperty({
    enum: APP_CHECK_SESSION_APPS,
    description: 'Application mobile Firebase (Android ou iOS)',
  })
  @IsIn(APP_CHECK_SESSION_APPS)
  app: AppCheckSessionApp;
}

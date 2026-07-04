import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const APP_CHECK_SESSION_APPS = ['android', 'ios', 'web'] as const;
export type AppCheckSessionApp = (typeof APP_CHECK_SESSION_APPS)[number];

export class CreateAppCheckSessionTokenDto {
  @ApiProperty({
    enum: APP_CHECK_SESSION_APPS,
    description:
      'Application Firebase (Android, iOS ou Web/Admin) pour un jeton session 7 j',
  })
  @IsIn(APP_CHECK_SESSION_APPS)
  app: AppCheckSessionApp;
}

import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ResponseFieldFilterInterceptor } from './response-field-filter.interceptor';

@Global()
@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseFieldFilterInterceptor,
    },
  ],
  exports: [],
})
export class FieldSelectionModule {}

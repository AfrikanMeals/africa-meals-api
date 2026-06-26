import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FieldProjectionCacheInterceptor } from './field-projection-cache.interceptor';
import { ResponseFieldFilterInterceptor } from './response-field-filter.interceptor';

@Global()
@Module({
  providers: [
    FieldProjectionCacheInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: FieldProjectionCacheInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseFieldFilterInterceptor,
    },
  ],
  exports: [FieldProjectionCacheInterceptor],
})
export class FieldSelectionModule {}

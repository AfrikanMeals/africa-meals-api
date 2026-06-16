import { StorageSettingsModule } from '@modules/storage-settings/storage-settings.module';
import { SharedModule } from '@modules/shared/shared.module';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { MediasController } from './medias.controller';
import { ImageCompressionService } from './image-compression.service';
import { MediasPublicProxyMiddleware } from './medias-public.middleware';
import { MediasService } from './medias.service';
import { StorageEngineFactory } from './storage-engine.factory';

@Module({
  imports: [SharedModule, StorageSettingsModule],
  providers: [
    MediasService,
    StorageEngineFactory,
    ImageCompressionService,
    MediasPublicProxyMiddleware,
  ],
  controllers: [MediasController],
  exports: [MediasService],
})
export class MediasModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MediasPublicProxyMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.GET,
    });
    consumer.apply(MediasPublicProxyMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.HEAD,
    });
  }
}

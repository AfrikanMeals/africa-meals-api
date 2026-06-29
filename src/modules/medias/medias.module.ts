import { StorageSettingsModule } from '@modules/storage-settings/storage-settings.module';
import { SharedModule } from '@modules/shared/shared.module';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
  forwardRef,
} from '@nestjs/common';
import { MediasController } from './medias.controller';
import { ImageCompressionService } from './image-compression.service';
import { MediasPublicProxyMiddleware } from './medias-public.middleware';
import { MediasService } from './medias.service';
import { StorageEngineFactory } from './storage-engine.factory';
import { StorageEngineProbeService } from './storage-engine-probe.service';

@Module({
  imports: [SharedModule, forwardRef(() => StorageSettingsModule)],
  providers: [
    MediasService,
    StorageEngineFactory,
    StorageEngineProbeService,
    ImageCompressionService,
    MediasPublicProxyMiddleware,
  ],
  controllers: [MediasController],
  exports: [MediasService, StorageEngineFactory, StorageEngineProbeService],
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

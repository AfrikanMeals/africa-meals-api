import { Global, Module } from '@nestjs/common';
import { ModuleCacheLayerService } from './module-cache-layer.service';

@Global()
@Module({
  providers: [ModuleCacheLayerService],
  exports: [ModuleCacheLayerService],
})
export class ModuleCacheLayerModule {}

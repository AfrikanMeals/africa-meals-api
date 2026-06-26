import { ModuleCacheLayerModule } from '@common/cache/module-cache-layer.module';
import { ShopHomeModule } from '@modules/shop-home/shop-home.module';
import { Global, Module } from '@nestjs/common';
import { InfraRecoveryService } from './infra-recovery.service';

@Global()
@Module({
  imports: [ModuleCacheLayerModule, ShopHomeModule],
  providers: [InfraRecoveryService],
  exports: [InfraRecoveryService],
})
export class InfraRecoveryModule {}

import { SearchModule } from '@modules/search/search.module';
import { StoreModule } from '@modules/store/store.module';
import { Module } from '@nestjs/common';
import { StoreMenuBundleService } from './store-menu-bundle.service';

@Module({
  imports: [StoreModule, SearchModule],
  providers: [StoreMenuBundleService],
  exports: [StoreMenuBundleService],
})
export class StoreMenuBundleModule {}

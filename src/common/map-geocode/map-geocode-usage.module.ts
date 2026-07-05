import { Global, Module } from '@nestjs/common';
import { MapGeocodeUsageTracker } from './map-geocode-usage.tracker';

@Global()
@Module({
  providers: [MapGeocodeUsageTracker],
  exports: [MapGeocodeUsageTracker],
})
export class MapGeocodeUsageModule {}

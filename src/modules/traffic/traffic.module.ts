import { Module, forwardRef } from '@nestjs/common';
import { MapSettingsModule } from '@modules/map-settings/map-settings.module';
import { SecretManagerModule } from '@modules/secret-manager/secret-manager.module';
import { TrafficFleetService } from './traffic-fleet.service';
import { TrafficExternalProviders } from './traffic-external.providers';
import { TrafficService } from './traffic.service';

@Module({
  imports: [forwardRef(() => MapSettingsModule), SecretManagerModule],
  providers: [TrafficFleetService, TrafficExternalProviders, TrafficService],
  exports: [TrafficService, TrafficFleetService],
})
export class TrafficModule {}

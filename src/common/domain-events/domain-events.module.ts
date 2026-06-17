import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InfraRuntimeSettingsModel,
  InfraRuntimeSettingsSchema,
} from '@schemas/infra-runtime-settings.schema';
import { DomainEventIdempotencyStore } from './domain-event-idempotency.store';
import { DomainEventPublisherService } from './domain-event-publisher.service';
import { DomainEventRegistryService } from './domain-event-registry.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      {
        name: InfraRuntimeSettingsModel.name,
        schema: InfraRuntimeSettingsSchema,
      },
    ]),
  ],
  providers: [
    DomainEventRegistryService,
    DomainEventIdempotencyStore,
    DomainEventPublisherService,
  ],
  exports: [
    DomainEventRegistryService,
    DomainEventPublisherService,
  ],
})
export class DomainEventsModule {}

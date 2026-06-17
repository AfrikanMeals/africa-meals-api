import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainEventEnvelope } from '../../../common/domain-events/domain-event.types';
import {
  AdClickPayload,
  AdConversionPayload,
  AdImpressionPayload,
} from '../../../common/domain-events/payloads/ad-domain-event.payloads';
import { WsAdManagerNotifyService } from '@modules/ws-notify/ws-ad-manager-notify.service';
import { WsAdsTargetingNotifyService } from '@modules/ws-notify/ws-ads-targeting-notify.service';
import { isDomainEventsWsViaBus } from '../domain-event-handlers.util';

@Injectable()
export class AdDomainEventHandler {
  constructor(
    private readonly config: ConfigService,
    private readonly adManager: WsAdManagerNotifyService,
    private readonly adsTargeting: WsAdsTargetingNotifyService,
  ) {}

  async handle(envelope: DomainEventEnvelope): Promise<void> {
    switch (envelope.type) {
      case 'ad.impression':
      case 'ad.click':
        this.onAdEngagement(
          envelope.type,
          envelope.payload as AdImpressionPayload | AdClickPayload,
          envelope.metadata,
        );
        break;
      case 'ad.conversion':
        this.onConversion(
          envelope.payload as AdConversionPayload,
          envelope.metadata,
        );
        break;
      default:
        break;
    }
  }

  private onAdEngagement(
    type: 'ad.impression' | 'ad.click',
    payload: AdImpressionPayload | AdClickPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): void {
    const scope =
      metadata?.orderContext?.adScope === 'CAMPAIGN' ? 'CAMPAIGN' : 'BANNER';
    if (!isDomainEventsWsViaBus(this.config)) {
      this.adManager.broadcastAdEvent({
        scope,
        eventType: type === 'ad.impression' ? 'impression' : 'click',
        entityId: payload.adId,
        storeId: payload.storeId,
      });
      this.adsTargeting.broadcastEventIngested({
        received: 1,
        queued: 0,
        eventType: type === 'ad.impression' ? 'impression' : 'click',
      });
    }
  }

  private onConversion(
    payload: AdConversionPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): void {
    if (isDomainEventsWsViaBus(this.config)) return;
    const scope =
      metadata?.orderContext?.adScope === 'CAMPAIGN' ? 'CAMPAIGN' : 'BANNER';
    this.adManager.broadcastAdEvent({
      scope,
      eventType: 'conversion',
      entityId: payload.adId,
      storeId: payload.storeId,
    });
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediasService } from '@modules/medias/medias.service';
import { PlatformThemeSettingsService } from '@modules/platform-theme-settings/platform-theme-settings.service';
import {
  resolveEmailBrand,
  escapeEmailHtml,
  type EmailBrand,
} from './email-brand.util';
import {
  shouldWrapEmailHtml,
  wrapEmailHtml,
  emailHeading,
  emailParagraph,
  emailMutedParagraph,
  emailDivider,
  emailPrimaryButton,
  emailHeroBanner,
  emailSectionImage,
  emailCodeBox,
  emailInfoPanel,
  emailKeyValueRows,
  type WrapEmailOptions,
} from './email-layout';

export {
  escapeEmailHtml,
  emailHeading,
  emailParagraph,
  emailMutedParagraph,
  emailDivider,
  emailPrimaryButton,
  emailHeroBanner,
  emailSectionImage,
  emailCodeBox,
  emailInfoPanel,
  emailKeyValueRows,
};

@Injectable()
export class EmailTemplateService {
  constructor(
    private readonly config: ConfigService,
    private readonly themeSettings: PlatformThemeSettingsService,
    private readonly medias: MediasService,
  ) {}

  getBrand(): EmailBrand {
    const base = resolveEmailBrand(this.config);
    return base;
  }

  async getBrandAsync(): Promise<EmailBrand> {
    const base = resolveEmailBrand(this.config);
    try {
      const logo = await this.themeSettings.getResolvedAppLogoUrl();
      if (logo) {
        return { ...base, logoUrl: logo };
      }
    } catch {
      /* repli env */
    }
    if (base.logoUrl) {
      const resolved =
        (await this.medias.resolvePublicMediaUrl(base.logoUrl)) ??
        base.logoUrl;
      return { ...base, logoUrl: resolved };
    }
    return base;
  }

  escapeHtml(value: string): string {
    return escapeEmailHtml(value);
  }

  shouldWrap(html: string): boolean {
    return shouldWrapEmailHtml(html);
  }

  wrapBody(bodyHtml: string, options?: WrapEmailOptions): string {
    return wrapEmailHtml(this.getBrand(), bodyHtml, options);
  }

  async wrapBodyAsync(
    bodyHtml: string,
    options?: WrapEmailOptions,
  ): Promise<string> {
    const brand = await this.getBrandAsync();
    let resolvedOptions = options;
    const heroRaw = options?.heroImageUrl?.trim();
    if (heroRaw) {
      const heroResolved =
        (await this.medias.resolvePublicMediaUrl(heroRaw)) ?? heroRaw;
      if (heroResolved !== heroRaw) {
        resolvedOptions = { ...options, heroImageUrl: heroResolved };
      }
    }
    return wrapEmailHtml(brand, bodyHtml, resolvedOptions);
  }

  heading = emailHeading;
  paragraph = emailParagraph;
  muted = emailMutedParagraph;
  divider = emailDivider;
  button = emailPrimaryButton;
  heroBanner = emailHeroBanner;
  sectionImage = emailSectionImage;
  codeBox = emailCodeBox;
  infoPanel = emailInfoPanel;
  keyValues = emailKeyValueRows;
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediasService } from '@modules/medias/medias.service';
import { PlatformThemeSettingsService } from '@modules/platform-theme-settings/platform-theme-settings.service';
import {
  resolveEmailBrand,
  escapeEmailHtml,
  type EmailBrand,
} from './email-brand.util';
import { resolveAllEmailHtmlStorageUrls } from './email-media-url.util';
import {
  resolveEmailImageUrl,
  resolveEmailWebSiteBase,
} from './email-web-asset-url.util';
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
    const webBase = resolveEmailWebSiteBase(this.config);
    try {
      const logo = await this.themeSettings.getResolvedAppLogoUrl();
      if (logo) {
        const resolved =
          (await resolveEmailImageUrl(logo, webBase)) ?? logo;
        return { ...base, logoUrl: resolved };
      }
    } catch {
      /* repli env */
    }
    if (base.logoUrl) {
      const resolved =
        (await resolveEmailImageUrl(base.logoUrl, webBase)) ?? base.logoUrl;
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

  /** Réécrit toutes les URLs stockage (img, JSON-LD, etc.) vers le site vitrine. */
  async resolveHtmlMediaUrls(html: string): Promise<string> {
    const webBase = resolveEmailWebSiteBase(this.config);
    return resolveAllEmailHtmlStorageUrls(
      html,
      (url) => resolveEmailImageUrl(url, webBase),
      webBase,
    );
  }

  async wrapBodyAsync(
    bodyHtml: string,
    options?: WrapEmailOptions,
  ): Promise<string> {
    const brand = await this.getBrandAsync();
    const bodyResolved = await this.resolveHtmlMediaUrls(bodyHtml);
    let resolvedOptions = options;
    const heroRaw = options?.heroImageUrl?.trim();
    if (heroRaw) {
      const webBase = resolveEmailWebSiteBase(this.config);
      const heroResolved =
        (await resolveEmailImageUrl(heroRaw, webBase)) ?? heroRaw;
      if (heroResolved !== heroRaw) {
        resolvedOptions = { ...options, heroImageUrl: heroResolved };
      }
    }
    return wrapEmailHtml(brand, bodyResolved, resolvedOptions);
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

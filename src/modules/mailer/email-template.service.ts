import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    return wrapEmailHtml(brand, bodyHtml, options);
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

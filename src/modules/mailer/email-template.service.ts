import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  constructor(private readonly config: ConfigService) {}

  getBrand(): EmailBrand {
    return resolveEmailBrand(this.config);
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

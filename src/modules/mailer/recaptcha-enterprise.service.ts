import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';

@Injectable()
export class RecaptchaEnterpriseService {
  private readonly logger = new Logger(RecaptchaEnterpriseService.name);
  private readonly googleAuth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  constructor(private readonly configService: ConfigService) {}

  async verify(token: string | undefined, expectedAction: string): Promise<void> {
    const apiKey =
      this.configService.get<string>('RECAPTCHA_ENTERPRISE_API_KEY')?.trim() ||
      '';
    const projectId =
      this.configService
        .get<string>('RECAPTCHA_ENTERPRISE_PROJECT_ID')
        ?.trim() ||
      this.configService.get<string>('AM_FIREBASE_PROJECT_ID')?.trim() ||
      this.configService.get<string>('GOOGLE_CLOUD_PROJECT')?.trim() ||
      '';
    const siteKey =
      this.configService.get<string>('RECAPTCHA_ENTERPRISE_SITE_KEY')?.trim() ||
      '';
    const enforce =
      String(
        this.configService.get<string>('RECAPTCHA_ENTERPRISE_ENFORCE') ?? '',
      ).toLowerCase() === 'true';

    if (!projectId || !siteKey) {
      if (enforce) {
        throw new BadRequestException('recaptcha_unavailable');
      }
      this.logger.warn(
        'reCAPTCHA config missing (projectId/siteKey) — skipped (monitor mode)',
      );
      return;
    }
    if (!token?.trim()) {
      if (enforce) throw new BadRequestException('recaptcha_token_missing');
      this.logger.warn('reCAPTCHA token missing (monitor mode)');
      return;
    }

    const threshold = Number(
      this.configService.get<string>('RECAPTCHA_ENTERPRISE_MIN_SCORE') ?? 0.5,
    );
    const minScore = Number.isFinite(threshold) ? threshold : 0.5;

    const { url, headers, skip } = await this.buildRecaptchaRequestAuth({
      apiKey,
      projectId,
      enforce,
    });
    if (skip) return;

    let resp: Response;
    let data: {
      tokenProperties?: {
        valid?: boolean;
        action?: string;
        invalidReason?: string;
      };
      riskAnalysis?: {
        score?: number;
      };
      error?: { message?: string };
    };
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          event: {
            token: token.trim(),
            expectedAction,
            siteKey,
          },
        }),
      });
      data = (await resp.json().catch(() => ({}))) as {
        tokenProperties?: {
          valid?: boolean;
          action?: string;
          invalidReason?: string;
        };
        riskAnalysis?: {
          score?: number;
        };
        error?: { message?: string };
      };
    } catch (e) {
      if (enforce) {
        throw new BadRequestException('recaptcha_assessment_failed');
      }
      this.logger.warn(
        `reCAPTCHA assessment network error (monitor mode): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return;
    }

    if (!resp.ok) {
      if (enforce) {
        throw new BadRequestException(
          data?.error?.message || 'recaptcha_assessment_failed',
        );
      }
      this.logger.warn(
        `reCAPTCHA assessment non-OK (monitor mode): ${
          data?.error?.message || resp.status
        }`,
      );
      return;
    }

    const valid = data?.tokenProperties?.valid === true;
    if (!valid) {
      const reason =
        data?.tokenProperties?.invalidReason || 'recaptcha_invalid_token';
      if (enforce) throw new BadRequestException(reason);
      this.logger.warn(`reCAPTCHA invalid token (monitor mode): ${reason}`);
      return;
    }

    const action = String(data?.tokenProperties?.action ?? '').trim();
    if (action !== expectedAction) {
      if (enforce) throw new BadRequestException('recaptcha_action_mismatch');
      this.logger.warn(
        `reCAPTCHA action mismatch (monitor mode): received=${
          action || 'empty'
        }`,
      );
      return;
    }

    const score = Number(data?.riskAnalysis?.score ?? 0);
    if (!Number.isFinite(score) || score < minScore) {
      if (enforce) throw new BadRequestException('recaptcha_low_score');
      this.logger.warn(
        `reCAPTCHA low score (monitor mode): score=${
          Number.isFinite(score) ? score : 'NaN'
        }, threshold=${minScore}`,
      );
    }
  }

  private async buildRecaptchaRequestAuth(args: {
    apiKey: string;
    projectId: string;
    enforce: boolean;
  }): Promise<{
    url: string;
    headers: Record<string, string>;
    skip?: boolean;
  }> {
    const { apiKey, projectId, enforce } = args;
    const baseUrl = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(
      projectId,
    )}/assessments`;

    if (apiKey) {
      return {
        url: `${baseUrl}?key=${encodeURIComponent(apiKey)}`,
        headers: {},
      };
    }

    try {
      const client = await this.googleAuth.getClient();
      const access = await client.getAccessToken();
      const token =
        typeof access === 'string'
          ? access
          : typeof access?.token === 'string'
            ? access.token
            : '';
      if (!token) {
        throw new Error('missing_access_token');
      }
      return {
        url: baseUrl,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };
    } catch (e) {
      if (enforce) {
        throw new BadRequestException('recaptcha_unavailable');
      }
      this.logger.warn(
        `reCAPTCHA auth unavailable (monitor mode): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { url: '', headers: {}, skip: true };
    }
  }
}

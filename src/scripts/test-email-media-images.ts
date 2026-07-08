/**
 * Envoie un e-mail de diagnostic des images (réécriture Firebase/GCS → site vitrine).
 *
 * Usage :
 *   npm run test:email-media
 *   npm run test:email-media -- --to=autre@email.com
 *   npm run test:email-media -- --dry-run
 *
 * Prérequis : `.env` avec SMTP configuré (voir docs/MAIL_SETUP.md).
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module';
import { EmailAiHeroImageService } from '@modules/mailer/email-ai-hero-image.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { MailerService } from '@modules/mailer/mailer.service';
import {
  resolveEmailImageUrl,
  resolveEmailWebSiteBase,
} from '@modules/mailer/email-web-asset-url.util';

const DEFAULT_TO = 'borissandeu0@gmail.com';

/** URLs Firebase legacy typiques (avant migration GCS). */
const LEGACY_SAMPLE_URLS = [
  {
    label: 'Logo thème (platform-theme)',
    url: 'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/platform-theme%2Flogo.png?alt=media&token=legacy-test',
  },
  {
    label: 'Image catalogue (plat)',
    url: 'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/catalog%2Fmeal.jpg?alt=media',
  },
  {
    label: 'Hero onboarding (email-heroes)',
    url: 'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/email-heroes%2Fonboarding%2Fvendor%2Fsample.png?alt=media',
  },
] as const;

type CliOptions = {
  to: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let to = DEFAULT_TO;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg.startsWith('--to=')) {
      const value = arg.slice('--to='.length).trim();
      if (value) to = value;
    }
  }

  return { to, dryRun };
}

function extractImgSrcUrls(html: string): string[] {
  const out: string[] = [];
  const re = /<img\b[^>]*\bsrc=(["'])([^"']+)\1/gi;
  for (const match of html.matchAll(re)) {
    const src = match[2]?.trim();
    if (src) out.push(src);
  }
  return out;
}

function isLegacyStorageUrl(url: string): boolean {
  return (
    url.includes('firebasestorage.googleapis.com') ||
    url.includes('storage.googleapis.com') ||
    url.includes('/medias/public/')
  );
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const config = app.get(ConfigService);
    const mailer = app.get(MailerService);
    const emailTpl = app.get(EmailTemplateService);
    const aiHero = app.get(EmailAiHeroImageService);

    const appName = config.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const webBase = resolveEmailWebSiteBase(config);
    const sentAt = new Date().toISOString();

    console.log('\n=== Test e-mail images (Firebase/GCS → site vitrine) ===');
    console.log(`Destinataire : ${opts.to}`);
    console.log(`Site vitrine : ${webBase}`);
    console.log(`Mode         : ${opts.dryRun ? 'dry-run (pas d\'envoi)' : 'envoi SMTP'}`);
    console.log('');

    const resolvedSamples: Array<{
      label: string;
      legacy: string;
      resolved: string;
    }> = [];
    for (const sample of LEGACY_SAMPLE_URLS) {
      const resolved =
        (await resolveEmailImageUrl(sample.url, webBase)) ?? sample.url;
      resolvedSamples.push({
        label: sample.label,
        legacy: sample.url,
        resolved,
      });
      console.log(`[${sample.label}]`);
      console.log(`  legacy   : ${sample.url}`);
      console.log(`  resolved : ${resolved}`);
      console.log(
        `  status   : ${!isLegacyStorageUrl(resolved) ? '→ WEB ✓' : '⚠ encore legacy'}`,
      );
      console.log('');
    }

    const staticSectionUrl =
      aiHero.resolveSectionImageUrl('help', `test-${sentAt}`) ??
      `${webBase}/images/help/help-section-01.png`;

    const heroImageUrl =
      (await aiHero.generateForOnboarding('vendor', `test-${sentAt}`)) ??
      undefined;

    const bodyParts = [
      emailTpl.heading('Test images e-mail — migration stockage'),
      emailTpl.paragraph(
        `Cet e-mail vérifie que les images Firebase/GCS legacy sont réécrites vers le site vitrine avant envoi (<strong>${emailTpl.escapeHtml(appName)}</strong>).`,
      ),
      emailTpl.heading('1. URLs Firebase legacy (doivent être réécrites)', 3),
    ];

    for (const row of resolvedSamples) {
      bodyParts.push(
        emailTpl.paragraph(`<strong>${emailTpl.escapeHtml(row.label)}</strong>`),
        emailTpl.sectionImage(row.legacy, row.label),
        emailTpl.muted(
          `Legacy : ${emailTpl.escapeHtml(row.legacy.slice(0, 120))}…`,
        ),
      );
    }

    bodyParts.push(
      emailTpl.divider(),
      emailTpl.heading('2. Image statique wise-eat.com (inchangée)', 3),
      emailTpl.sectionImage(staticSectionUrl, 'Section aide — site vitrine'),
      emailTpl.muted(`URL : ${emailTpl.escapeHtml(staticSectionUrl)}`),
      emailTpl.divider(),
      emailTpl.muted(`Diagnostic généré le ${emailTpl.escapeHtml(sentAt)}`),
    );

    const rawBodyHtml = bodyParts.join('\n');

    if (opts.dryRun) {
      const preview = await emailTpl.resolveHtmlMediaUrls(rawBodyHtml);
      console.log('--- URLs <img> après resolveHtmlMediaUrls ---');
      for (const src of extractImgSrcUrls(preview)) {
        console.log(
          `  ${isLegacyStorageUrl(src) ? '⚠ legacy  ' : '✓ web     '} ${src}`,
        );
      }
      if (heroImageUrl) {
        console.log(`Hero bannière : ${heroImageUrl}`);
      }
      console.log('');
      console.log('Dry-run terminé — aucun e-mail envoyé.');
      return;
    }

    const smtpUser = config.get<string>('SMTP_USER')?.trim();
    const smtpPass =
      config.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      config.get<string>('SMTP_PASS')?.trim();
    if (!smtpUser || !smtpPass) {
      console.error(
        'Erreur : SMTP_USER et SMTP_APP_PASSWORD requis dans .env (voir docs/MAIL_SETUP.md).',
      );
      process.exitCode = 1;
      return;
    }

    await mailer.sendSimple({
      to: opts.to,
      toName: 'Test images',
      subject: `[TEST] Images e-mail — ${appName}`,
      html: rawBodyHtml,
      text: [
        `Test images e-mail — ${appName}`,
        '',
        'Vérifiez que les images s’affichent (URLs wise-eat.com, pas Firebase/GCS).',
        '',
        ...resolvedSamples.map(
          (r) => `${r.label}\n  legacy: ${r.legacy}\n  resolved: ${r.resolved}`,
        ),
        '',
        `Statique: ${staticSectionUrl}`,
        heroImageUrl ? `Hero: ${heroImageUrl}` : '',
        '',
        sentAt,
      ]
        .filter(Boolean)
        .join('\n'),
      heroImageUrl,
      heroImageAlt: 'Bannière test onboarding',
      logContext: 'test_email_media_images',
    });

    console.log(`✓ E-mail envoyé à ${opts.to}`);
    console.log(
      '  Ouvrez Gmail et vérifiez : logo header, bannière hero, 3 images legacy réécrites, 1 image statique.',
    );
  } finally {
    await app.close();
  }
}

void run().catch((err) => {
  console.error(err);
  process.exit(1);
});

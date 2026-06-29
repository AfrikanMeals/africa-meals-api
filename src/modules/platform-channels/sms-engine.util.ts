import { SmsEngineEnum } from '@schemas/maintenance-alert-settings.schema';

export const SMS_ENGINE_AUTO = SmsEngineEnum.AUTO;
export const SMS_ENGINE_BIRD = SmsEngineEnum.BIRD;
export const SMS_ENGINE_TWILIO = SmsEngineEnum.TWILIO;

export type SmsEngineOption = {
  value: string;
  label: string;
  hint: string;
  configured: boolean;
};

export function normalizeSmsEngine(raw: string | undefined | null): string {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === SMS_ENGINE_TWILIO) return SMS_ENGINE_TWILIO;
  if (v === SMS_ENGINE_AUTO) return SMS_ENGINE_AUTO;
  return SMS_ENGINE_BIRD;
}

export function buildSmsEngineOptions(args: {
  birdConfigured: boolean;
  twilioConfigured: boolean;
}): SmsEngineOption[] {
  const anyConfigured = args.birdConfigured || args.twilioConfigured;
  return [
    {
      value: SMS_ENGINE_AUTO,
      label: 'Auto',
      hint: 'Choisit Bird ou Twilio aléatoirement parmi les moteurs configurés.',
      configured: anyConfigured,
    },
    {
      value: SMS_ENGINE_BIRD,
      label: 'MessageBird (Bird)',
      hint: 'SMS via Bird Channels API (BIRD_ACCESS_KEY, workspace, canal SMS).',
      configured: args.birdConfigured,
    },
    {
      value: SMS_ENGINE_TWILIO,
      label: 'Twilio',
      hint: 'SMS via Twilio Programmable Messaging.',
      configured: args.twilioConfigured,
    },
  ];
}

import { BadRequestException } from '@nestjs/common';

export type StoreWorkingHoursSlotInput = {
  open: string;
  close: string;
};

export type StoreWorkingHoursDayInput = {
  dayOfWeek: number;
  closed?: boolean;
  open24h?: boolean;
  slots?: StoreWorkingHoursSlotInput[];
};

export type StoreWorkingHoursInput = {
  enabled?: boolean;
  schedule?: StoreWorkingHoursDayInput[];
};

export type NormalizedStoreWorkingHours = {
  enabled: boolean;
  schedule: Array<{
    dayOfWeek: number;
    closed: boolean;
    open24h: boolean;
    slots: StoreWorkingHoursSlotInput[];
  }>;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseMinutes(value: string): number {
  const m = TIME_RE.exec(String(value).trim());
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isValidIanaTimezone(tz: string): boolean {
  const normalized = String(tz ?? '').trim();
  if (!normalized) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: normalized });
    return true;
  } catch {
    return false;
  }
}

export function normalizeStoreTimezone(
  value: unknown,
  fallback?: string,
): string | undefined {
  if (value === undefined || value === null) {
    const fb = String(fallback ?? '').trim();
    return fb && isValidIanaTimezone(fb) ? fb : undefined;
  }
  const tz = String(value).trim();
  if (!tz) return undefined;
  if (!isValidIanaTimezone(tz)) {
    throw new BadRequestException('invalid_timezone');
  }
  return tz;
}

function normalizeSlot(raw: StoreWorkingHoursSlotInput): StoreWorkingHoursSlotInput {
  const open = String(raw.open ?? '').trim();
  const close = String(raw.close ?? '').trim();
  const openMin = parseMinutes(open);
  const closeMin = parseMinutes(close);
  if (openMin < 0 || closeMin < 0) {
    throw new BadRequestException('invalid_working_hours_time_format');
  }
  if (openMin >= closeMin) {
    throw new BadRequestException('invalid_working_hours_slot_range');
  }
  return { open, close };
}

function normalizeDay(
  raw: StoreWorkingHoursDayInput,
): NormalizedStoreWorkingHours['schedule'][number] {
  const dayOfWeek = Number(raw.dayOfWeek);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new BadRequestException('invalid_working_hours_day');
  }
  const closed = !!raw.closed;
  const open24h = !closed && !!raw.open24h;
  if (closed && open24h) {
    throw new BadRequestException('invalid_working_hours_day_state');
  }
  const rawSlots = Array.isArray(raw.slots) ? raw.slots : [];
  if (closed) {
    return { dayOfWeek, closed: true, open24h: false, slots: [] };
  }
  if (open24h) {
    return { dayOfWeek, closed: false, open24h: true, slots: [] };
  }
  if (rawSlots.length === 0) {
    throw new BadRequestException('working_hours_slots_required');
  }
  const slots = rawSlots.map(normalizeSlot).sort((a, b) => {
    return parseMinutes(a.open) - parseMinutes(b.open);
  });
  for (let i = 1; i < slots.length; i += 1) {
    const prevClose = parseMinutes(slots[i - 1].close);
    const nextOpen = parseMinutes(slots[i].open);
    if (nextOpen < prevClose) {
      throw new BadRequestException('working_hours_slots_overlap');
    }
  }
  return { dayOfWeek, closed: false, open24h: false, slots };
}

export function defaultWorkingHoursSchedule(): NormalizedStoreWorkingHours['schedule'] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    closed: false,
    open24h: false,
    slots: [{ open: '09:00', close: '22:00' }],
  }));
}

export function normalizeStoreWorkingHours(
  input: StoreWorkingHoursInput | undefined | null,
): NormalizedStoreWorkingHours | undefined {
  if (input === undefined || input === null) return undefined;
  const enabled = input.enabled !== false;
  const scheduleInput = Array.isArray(input.schedule) ? input.schedule : [];
  const byDay = new Map<number, StoreWorkingHoursDayInput>();
  for (const row of scheduleInput) {
    byDay.set(Number(row.dayOfWeek), row);
  }
  const schedule = Array.from({ length: 7 }, (_, dayOfWeek) => {
    const row = byDay.get(dayOfWeek);
    if (!row) {
      return {
        dayOfWeek,
        closed: true,
        open24h: false,
        slots: [] as StoreWorkingHoursSlotInput[],
      };
    }
    return normalizeDay({ ...row, dayOfWeek });
  });
  return { enabled, schedule };
}

export function serializeStoreWorkingHoursForApi(
  doc: Record<string, unknown> | undefined | null,
): NormalizedStoreWorkingHours | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const enabled = doc.enabled !== false;
  const rawSchedule = Array.isArray(doc.schedule) ? doc.schedule : [];
  if (rawSchedule.length === 0 && doc.enabled === undefined) {
    return undefined;
  }
  const schedule = Array.from({ length: 7 }, (_, dayOfWeek) => {
    const row = rawSchedule.find(
      (r) => Number((r as { dayOfWeek?: number }).dayOfWeek) === dayOfWeek,
    ) as Record<string, unknown> | undefined;
    if (!row) {
      return {
        dayOfWeek,
        closed: true,
        open24h: false,
        slots: [] as StoreWorkingHoursSlotInput[],
      };
    }
    const closed = !!row.closed;
    const open24h = !closed && !!row.open24h;
    const slots = (Array.isArray(row.slots) ? row.slots : []).map((s) => {
      const slot = s as Record<string, unknown>;
      return {
        open: String(slot.open ?? ''),
        close: String(slot.close ?? ''),
      };
    });
    return { dayOfWeek, closed, open24h, slots };
  });
  return { enabled, schedule };
}

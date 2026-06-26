export type UsageTimePeakHour = { hour: number; sessions: number };
export type UsageTimePeakDay = { day: number; sessions: number };

export type UsageTimeSourceStats = {
  sessionsCount: number;
  avgSessionSec: number;
  totalTimeSec: number;
  lastActiveAt: string | null;
  peakHours: UsageTimePeakHour[];
  peakDays: UsageTimePeakDay[];
};

export type AdminUserUsageTimeResponse = {
  userId: string;
  rangeDays: number;
  mobile: UsageTimeSourceStats;
  admin: UsageTimeSourceStats;
};

export type SystemExchangeStatus =
  | 'healthy'
  | 'degraded'
  | 'down'
  | 'disabled'
  | 'unknown';

export type SystemExchangePlatform = {
  id: string;
  label: string;
  layer: 'data' | 'infra' | 'service' | 'client';
  role: string;
  status: SystemExchangeStatus;
  latencyMs: number | null;
  details: string;
  endpoint: string | null;
};

export type SystemExchangeLink = {
  id: string;
  from: string;
  to: string;
  protocol: string;
  label: string;
  status: SystemExchangeStatus;
  latencyMs: number | null;
  details: string;
};

export type SystemExchangeResponse = {
  checkedAt: string;
  environment: string;
  platforms: SystemExchangePlatform[];
  links: SystemExchangeLink[];
  summary: {
    healthy: number;
    degraded: number;
    down: number;
    disabled: number;
    unknown: number;
  };
};

export type HttpLogLevel = 'info' | 'warn' | 'error';

export type HttpLogEnvironment = 'Development' | 'Production' | 'Test' | 'Staging';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
} as const;

function envFlag(name: string): boolean | undefined {
  const raw = String(process.env[name] ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

let cachedHttpLogEnvironment: HttpLogEnvironment | null = null;

export function resolveHttpLogEnvironment(
  nodeEnv = process.env.NODE_ENV,
): HttpLogEnvironment {
  const raw = String(nodeEnv ?? 'development')
    .trim()
    .toLowerCase();
  if (raw === 'production' || raw === 'prod') return 'Production';
  if (raw === 'test') return 'Test';
  if (raw === 'staging' || raw === 'stage') return 'Staging';
  return 'Development';
}

export function httpLogEnvironmentLabel(): HttpLogEnvironment {
  if (cachedHttpLogEnvironment == null) {
    cachedHttpLogEnvironment = resolveHttpLogEnvironment();
  }
  return cachedHttpLogEnvironment;
}

export function colorForHttpEnvironment(env: HttpLogEnvironment): string {
  switch (env) {
    case 'Production':
      return ANSI.magenta;
    case 'Test':
      return ANSI.yellow;
    case 'Staging':
      return ANSI.cyan;
    default:
      return ANSI.green;
  }
}

export function isHttpBodyLoggingEnabled(): boolean {
  if (process.env.LOG_HTTP_BODIES !== 'true') {
    return false;
  }
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.LOG_HTTP_BODIES_IN_PROD !== 'true'
  ) {
    return false;
  }
  return true;
}

/** Journalise les requêtes HTTP terminées (méthode, URL, status, durée). */
export function isHttpRequestLoggingEnabled(): boolean {
  const explicit = envFlag('LOG_HTTP_REQUESTS');
  if (explicit != null) return explicit;
  if (isHttpBodyLoggingEnabled()) return true;
  return process.env.NODE_ENV !== 'production';
}

export function shouldUseHttpLogColors(): boolean {
  const explicit = envFlag('LOG_HTTP_USE_COLORS');
  if (explicit != null) return explicit;
  if (process.env.NO_COLOR === '1') return false;
  if (process.env.FORCE_COLOR === '1') return true;
  return Boolean(process.stdout.isTTY);
}

export function httpLogLevelForStatus(status: number): HttpLogLevel {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export function colorForHttpStatus(status: number): string {
  if (status >= 500) return ANSI.red;
  if (status >= 400) return ANSI.yellow;
  if (status >= 300) return ANSI.cyan;
  if (status >= 200) return ANSI.green;
  if (status <= 0) return ANSI.magenta;
  return ANSI.gray;
}

export function colorForHttpMethod(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return ANSI.cyan;
    case 'POST':
      return ANSI.green;
    case 'PUT':
    case 'PATCH':
      return ANSI.yellow;
    case 'DELETE':
      return ANSI.red;
    default:
      return ANSI.gray;
  }
}

export type HttpRequestLogLineInput = {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  environment?: HttpLogEnvironment;
  bodySuffix?: string;
  useColors?: boolean;
};

export function formatHttpRequestLogLine(input: HttpRequestLogLineInput): string {
  const method = input.method.toUpperCase();
  const status =
    input.status > 0 ? String(input.status) : '—';
  const duration = `${Math.max(0, Math.round(input.durationMs))}ms`;
  const bodySuffix = input.bodySuffix ?? '';
  const useColors = input.useColors ?? shouldUseHttpLogColors();
  const environment = input.environment ?? httpLogEnvironmentLabel();

  if (!useColors) {
    return `[HTTP] [${environment}] ${method} ${input.url} ${status} ${duration}${bodySuffix}`;
  }

  const statusColor = colorForHttpStatus(input.status);
  const methodColor = colorForHttpMethod(method);
  const envColor = colorForHttpEnvironment(environment);
  return (
    `${ANSI.gray}[HTTP]${ANSI.reset} ` +
    `${envColor}${ANSI.bold}[${environment}]${ANSI.reset} ` +
    `${methodColor}${ANSI.bold}${method}${ANSI.reset} ` +
    `${input.url} ` +
    `${statusColor}${ANSI.bold}${status}${ANSI.reset} ` +
    `${ANSI.dim}${duration}${ANSI.reset}` +
    bodySuffix
  );
}

export function writeHttpRequestLog(line: string, status: number): void {
  const level = httpLogLevelForStatus(status);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

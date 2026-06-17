const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'code',
  'activationcode',
  'verificationcode',
  'passwordresetcode',
  'email2faenablecode',
  'email2falogincode',
  'refreshtoken',
  'authtoken',
  'idtoken',
  'token',
  'challengetoken',
  'smtp_app_password',
  'smtp_pass',
  'authorization',
])

const REDACTED = '[REDACTED]'

export function isSensitiveLogKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.trim().toLowerCase())
}

export function redactSensitiveValue(key: string, value: unknown): unknown {
  if (isSensitiveLogKey(key)) {
    return REDACTED
  }
  return redactSensitiveObject(value)
}

export function redactSensitiveObject(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 6) return REDACTED
  if (value == null) return value
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveObject(item, depth + 1))
  }
  if (typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveLogKey(key)
      ? REDACTED
      : redactSensitiveObject(nested, depth + 1)
  }
  return out
}

export function redactSensitiveJsonForLog(value: unknown): string {
  try {
    return JSON.stringify(redactSensitiveObject(value))
  } catch {
    return '[unserializable]'
  }
}

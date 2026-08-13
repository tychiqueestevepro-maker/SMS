import 'server-only'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogContext {
  event: string
  workspace_id?: string
  campaign_id?: string
  campaign_recipient_id?: string
  contact_id?: string
  message_id?: string
  phone_number_id?: string
  provider_message_id?: string
  stripe_event_id?: string
  dispatch_state?: string
}

const secretKeyPattern = /(secret|token|password|credential|api[-_]?key|card)/i

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\b(?:seti|pi)_[A-Za-z0-9]+_secret_[A-Za-z0-9_-]+\b/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/([?&](?:token|secret|password|api_?key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(
      /\b(auth(?:entication)?[ _-]?token|api[ _-]?key|secret|password|credential)\s*(?:[:=]\s*|\s+)\S+/gi,
      '$1=[REDACTED]',
    )
    .replace(/\b[a-f\d]{32}\b/gi, '[REDACTED]')
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (typeof value === 'string') return redactString(value)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      secretKeyPattern.test(key) ? '[REDACTED]' : redact(nested),
    ]),
  )
}

export function logServerEvent(
  level: LogLevel,
  context: LogContext,
  details: Record<string, unknown> = {},
) {
  const entry = {
    ...redact(details) as Record<string, unknown>,
    ...context,
    timestamp: new Date().toISOString(),
  }

  const output = JSON.stringify(entry)
  if (level === 'error') console.error(output)
  else if (level === 'warn') console.warn(output)
  else console.info(output)
}

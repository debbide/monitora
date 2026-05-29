export type HeaderMap = Record<string, string>

function objectToHeaders(value: Record<string, unknown>): HeaderMap {
  const headers: HeaderMap = {}

  for (const [key, headerValue] of Object.entries(value)) {
    const name = key.trim()
    if (!name || headerValue === undefined || headerValue === null) continue
    headers[name] = String(headerValue)
  }

  return headers
}

function looksLikeCookieString(value: string): boolean {
  return !value.includes('\n') && value.includes('=')
}

function parseHeaderLines(value: string): HeaderMap | null {
  const lines = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return {}
  if (!lines.every(line => line.includes(':'))) return null

  const headers: HeaderMap = {}
  for (const line of lines) {
    const separatorIndex = line.indexOf(':')
    const name = line.slice(0, separatorIndex).trim()
    const headerValue = line.slice(separatorIndex + 1).trim()
    if (!name || name.includes('=') || name.includes(';')) return null
    headers[name] = headerValue
  }

  return headers
}

export function parseHeaderInput(input: unknown): HeaderMap {
  if (!input) return {}

  if (typeof input === 'object' && !Array.isArray(input)) {
    return objectToHeaders(input as Record<string, unknown>)
  }

  if (typeof input !== 'string') {
    throw new Error('Headers must be an object or string')
  }

  const value = input.trim()
  if (!value) return {}

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return objectToHeaders(parsed as Record<string, unknown>)
    }
  } catch {
    // Continue with non-JSON formats below.
  }

  const lineHeaders = parseHeaderLines(value)
  if (lineHeaders) return lineHeaders

  if (looksLikeCookieString(value)) {
    return { Cookie: value }
  }

  throw new Error('Headers format must be JSON, Header: value lines, or a Cookie string')
}

export function normalizeHeadersForStorage(input: unknown): string | null {
  const headers = parseHeaderInput(input)
  return Object.keys(headers).length > 0 ? JSON.stringify(headers) : null
}

export function parseStoredHeaders(input: string | null | undefined): HeaderMap {
  if (!input) return {}
  return parseHeaderInput(input)
}

export function normalizeJsonForStorage(input: unknown): string | null {
  if (!input) return null

  if (typeof input === 'object') {
    return JSON.stringify(input)
  }

  if (typeof input !== 'string') {
    throw new Error('Body must be JSON')
  }

  const value = input.trim()
  if (!value) return null

  return JSON.stringify(JSON.parse(value))
}

export function redactHeaders(headers: HeaderMap): HeaderMap {
  const sensitiveNames = new Set(['cookie', 'authorization', 'x-api-key', 'x-auth-token', 'set-cookie'])
  const redacted: HeaderMap = {}

  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = sensitiveNames.has(key.toLowerCase()) ? '[REDACTED]' : value
  }

  return redacted
}

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

export function parseHeaderInput(input: string): HeaderMap {
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

  throw new Error('请输入 JSON、每行 Header: value，或完整 Cookie 字符串')
}

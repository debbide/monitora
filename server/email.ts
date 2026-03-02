import { ImapFlow, FetchMessageObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import { queryAll, queryFirst, run } from './db.js'
import { EmailRule, EmailCode } from './types.js'

type EmailSettings = {
  enabled: boolean
  host: string
  port: number
  user: string
  password: string
  tls: boolean
}

type EmailStatus = {
  connected: boolean
  last_error: string
  last_sync_at: string
}

type Waiter = {
  resolve: (code: EmailCode) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
  markUsed: boolean
  maxAgeSeconds: number
}

let client: ImapFlow | null = null
let connectPromise: Promise<void> | null = null
let status: EmailStatus = {
  connected: false,
  last_error: '',
  last_sync_at: ''
}
let lastUid = 0
let scanRunning = false
let fallbackTimer: ReturnType<typeof setInterval> | null = null
const waitersByRule = new Map<string, Set<Waiter>>()

function getSetting(key: string): string {
  const row = queryFirst('SELECT value FROM system_settings WHERE key = ?', [key]) as
    | { value: string }
    | null
  return row?.value ?? ''
}

function setSetting(key: string, value: string) {
  run(
    'INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))',
    [key, value]
  )
}

function loadEmailSettings(): EmailSettings {
  const enabled = getSetting('email_imap_enabled') === '1'
  const host = getSetting('email_imap_host') || 'imap.gmail.com'
  const port = parseInt(getSetting('email_imap_port') || '993', 10)
  const user = getSetting('email_imap_user') || ''
  const password = getSetting('email_imap_password') || ''
  const tls = getSetting('email_imap_tls') !== '0'
  return { enabled, host, port, user, password, tls }
}

function parseAddressList(list?: { address?: string }[] | null): string[] {
  if (!list || list.length === 0) return []
  return list.map(item => (item.address || '').toLowerCase()).filter(Boolean)
}

function normalizeText(value?: string | null): string {
  return (value || '').toLowerCase().trim()
}

function splitFilters(value: string): string[] {
  return value
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
}

function extractTextFromSource(source: Buffer | string | undefined): string {
  if (!source) return ''
  const raw = typeof source === 'string' ? source : source.toString('utf8')
  const withoutTags = raw.replace(/<[^>]*>/g, ' ')
  return withoutTags.replace(/\s+/g, ' ').trim()
}

function stripHtmlToText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function parseBodyText(source: Buffer | string | undefined): Promise<string> {
  if (!source) return ''
  try {
    const parsed = await simpleParser(source)
    if (parsed.text && parsed.text.trim()) {
      return parsed.text
    }
    const htmlValue = (parsed as { html?: string | Buffer | null }).html
    if (htmlValue) {
      const html = typeof htmlValue === 'string' ? htmlValue : htmlValue.toString()
      return stripHtmlToText(html)
    }
  } catch {
    // ignore and fallback to raw extraction
  }
  return extractTextFromSource(source)
}

function getRules(): EmailRule[] {
  return queryAll('SELECT * FROM email_rules WHERE enabled = 1 ORDER BY created_at DESC') as EmailRule[]
}

function getRuleBySiteKey(siteKey: string): EmailRule | null {
  const row = queryFirst('SELECT * FROM email_rules WHERE site_key = ? AND enabled = 1', [siteKey])
  return row as EmailRule | null
}

function shouldMatchRule(rule: EmailRule, from: string, toList: string[], subject: string, body: string) {
  const fromFilters = splitFilters(rule.from_filter)
  const fromMatch = fromFilters.length === 0 || fromFilters.some(f => from.includes(f))
  if (!fromMatch) return false

  if (rule.to_email) {
    const toMatch = toList.some(addr => addr.includes(rule.to_email!.toLowerCase()))
    if (!toMatch) return false
  }

  if (rule.subject_keyword) {
    if (!subject.includes(rule.subject_keyword.toLowerCase())) return false
  }

  if (rule.body_keyword) {
    if (!body.includes(rule.body_keyword.toLowerCase())) return false
  }

  return true
}

function getLatestCode(ruleId: string, maxAgeSeconds: number): EmailCode | null {
  const row = queryFirst(
    'SELECT * FROM email_codes WHERE rule_id = ? AND used = 0 ORDER BY received_at DESC LIMIT 1',
    [ruleId]
  ) as EmailCode | null
  if (!row) return null
  if (!row.received_at) return row
  const receivedAt = new Date(row.received_at).getTime()
  if (Number.isNaN(receivedAt)) return row
  if (Date.now() - receivedAt > maxAgeSeconds * 1000) return null
  return row
}

function markCodeUsed(codeId: number | undefined) {
  if (!codeId) return
  run('UPDATE email_codes SET used = 1 WHERE id = ?', [codeId])
}

function notifyWaiters(ruleId: string, code: EmailCode) {
  const waiters = waitersByRule.get(ruleId)
  if (!waiters || waiters.size === 0) return
  for (const waiter of Array.from(waiters)) {
    clearTimeout(waiter.timeoutId)
    waiters.delete(waiter)
    if (waiter.markUsed) {
      markCodeUsed(code.id)
    }
    waiter.resolve(code)
  }
}

function storeCode(ruleId: string, code: string, messageId: string, from: string, subject: string, receivedAt: string) {
  if (messageId) {
    const existing = queryFirst(
      'SELECT id FROM email_codes WHERE rule_id = ? AND message_id = ?',
      [ruleId, messageId]
    ) as { id: number } | null
    if (existing) return
  }
  run(
    `INSERT INTO email_codes (rule_id, code, message_id, from_address, subject, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ruleId, code, messageId || null, from, subject, receivedAt]
  )
  const saved = queryFirst(
    'SELECT * FROM email_codes WHERE rule_id = ? ORDER BY received_at DESC LIMIT 1',
    [ruleId]
  ) as EmailCode | null
  if (saved) notifyWaiters(ruleId, saved)
}

async function scanNewMessages() {
  if (!client || scanRunning) return
  scanRunning = true
  try {
    const rules = getRules()
    if (rules.length === 0) return

    const lock = await client.getMailboxLock('INBOX')
    try {
      if (!lastUid) {
        const mailbox = client.mailbox as (typeof client.mailbox & { uidNext?: number }) | null
        const nextUid = mailbox?.uidNext || 0
        lastUid = Math.max(nextUid - 1, 0)
        setSetting('email_last_uid', String(lastUid))
        return
      }

      const range = `${lastUid + 1}:*`
      for await (const message of client.fetch(range, {
        uid: true,
        envelope: true,
        internalDate: true,
        source: true
      })) {
        lastUid = Math.max(lastUid, message.uid || lastUid)
        await processMessage(message, rules)
      }
    } finally {
      lock.release()
    }

    if (lastUid) {
      setSetting('email_last_uid', String(lastUid))
    }
    status.last_sync_at = new Date().toISOString()
    setSetting('email_last_sync_at', status.last_sync_at)
  } catch (error: any) {
    status.last_error = error?.message || 'Email scan failed'
    setSetting('email_last_error', status.last_error)
  } finally {
    scanRunning = false
  }
}

async function processMessage(message: FetchMessageObject, rules: EmailRule[]) {
  const envelope = message.envelope
  const fromList = parseAddressList(envelope?.from)
  const toList = parseAddressList(envelope?.to)
  const from = fromList[0] || ''
  const subject = normalizeText(envelope?.subject || '')
  const receivedAt = message.internalDate
    ? new Date(message.internalDate).toISOString()
    : new Date().toISOString()
  const bodyText = normalizeText(await parseBodyText(message.source))
  const messageId = (envelope?.messageId || '').trim()

  for (const rule of rules) {
    const maxAge = rule.max_age_seconds || 300
    if (receivedAt && maxAge > 0) {
      const delta = Date.now() - new Date(receivedAt).getTime()
      if (delta > maxAge * 1000) continue
    }

    if (!shouldMatchRule(rule, from, toList, subject, bodyText)) continue

    let regex: RegExp
    try {
      regex = new RegExp(rule.code_regex, 'i')
    } catch {
      continue
    }

    const match = regex.exec(bodyText) || regex.exec(subject)
    if (!match) continue

    const code = match[1] || match[0]
    if (!code) continue

    storeCode(rule.id, code, messageId, from, envelope?.subject || '', receivedAt)
  }
}

export async function startEmailWatcher() {
  if (connectPromise) return connectPromise
  const settings = loadEmailSettings()
  if (!settings.enabled || !settings.user || !settings.password) {
    status.connected = false
    return
  }
  if (client && status.connected) return

  connectPromise = (async () => {
    try {
      status.last_error = ''
      client = new ImapFlow({
        host: settings.host,
        port: settings.port,
        secure: settings.tls,
        auth: {
          user: settings.user,
          pass: settings.password
        }
      })
      client.on('error', err => {
        status.last_error = err?.message || 'IMAP error'
        setSetting('email_last_error', status.last_error)
      })
      client.on('close', () => {
        status.connected = false
      })

      await client.connect()
      const mailbox = await client.mailboxOpen('INBOX')
      status.connected = true

      const storedUid = parseInt(getSetting('email_last_uid') || '0', 10)
      lastUid = Number.isNaN(storedUid) ? 0 : storedUid
      if (!lastUid) {
        const nextUid = mailbox?.uidNext || 0
        lastUid = Math.max(nextUid - 1, 0)
        setSetting('email_last_uid', String(lastUid))
      }

      client.on('exists', () => {
        scanNewMessages().catch(() => undefined)
      })

      if (!fallbackTimer) {
        fallbackTimer = setInterval(() => {
          if (status.connected) {
            scanNewMessages().catch(() => undefined)
          }
        }, 30000)
      }

      await scanNewMessages()
    } catch (error: any) {
      status.last_error = error?.message || 'IMAP connection failed'
      setSetting('email_last_error', status.last_error)
      status.connected = false
      if (client) {
        try {
          await client.logout()
        } catch {
          // ignore
        }
      }
      client = null
    } finally {
      connectPromise = null
    }
  })()

  return connectPromise
}

export async function stopEmailWatcher() {
  if (fallbackTimer) {
    clearInterval(fallbackTimer)
    fallbackTimer = null
  }
  if (client) {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }
  client = null
  status.connected = false
}

export async function refreshEmailWatcher() {
  await stopEmailWatcher()
  await startEmailWatcher()
  if (!status.connected) {
    throw new Error('Email not connected')
  }
}

export function getEmailStatus(): EmailStatus {
  return {
    connected: status.connected,
    last_error: status.last_error || getSetting('email_last_error') || '',
    last_sync_at: status.last_sync_at || getSetting('email_last_sync_at') || ''
  }
}

export function listEmailRules(): EmailRule[] {
  return queryAll('SELECT * FROM email_rules ORDER BY created_at DESC') as EmailRule[]
}

export function createEmailRule(rule: Omit<EmailRule, 'id' | 'created_at' | 'updated_at'> & { id: string }) {
  run(
    `INSERT INTO email_rules (
      id, site_key, from_filter, subject_keyword, body_keyword, code_regex, to_email,
      timeout_seconds, max_age_seconds, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      rule.id,
      rule.site_key,
      rule.from_filter,
      rule.subject_keyword || null,
      rule.body_keyword || null,
      rule.code_regex,
      rule.to_email || null,
      rule.timeout_seconds,
      rule.max_age_seconds,
      rule.enabled
    ]
  )
}

export function updateEmailRule(id: string, rule: Partial<EmailRule>) {
  run(
    `UPDATE email_rules SET
      site_key = ?,
      from_filter = ?,
      subject_keyword = ?,
      body_keyword = ?,
      code_regex = ?,
      to_email = ?,
      timeout_seconds = ?,
      max_age_seconds = ?,
      enabled = ?,
      updated_at = datetime('now')
    WHERE id = ?`,
    [
      rule.site_key,
      rule.from_filter,
      rule.subject_keyword || null,
      rule.body_keyword || null,
      rule.code_regex,
      rule.to_email || null,
      rule.timeout_seconds,
      rule.max_age_seconds,
      rule.enabled,
      id
    ]
  )
}

export function deleteEmailRule(id: string) {
  run('DELETE FROM email_rules WHERE id = ?', [id])
}

export async function requestEmailCode(siteKey: string, timeoutSeconds?: number, markUsed = true) {
  const rule = getRuleBySiteKey(siteKey)
  if (!rule) {
    throw new Error('Rule not found')
  }

  const settings = loadEmailSettings()
  if (!settings.enabled) {
    throw new Error('Email service disabled')
  }
  if (!settings.user || !settings.password) {
    throw new Error('Email credentials not configured')
  }

  const maxAge = rule.max_age_seconds || 300
  const latest = getLatestCode(rule.id, maxAge)
  if (latest) {
    if (markUsed) {
      markCodeUsed(latest.id)
    }
    return latest
  }

  await startEmailWatcher()

  const waitTimeout = timeoutSeconds || rule.timeout_seconds || 120

  return new Promise<EmailCode>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const waiters = waitersByRule.get(rule.id)
      if (waiters) {
        for (const waiter of waiters) {
          if (waiter.timeoutId === timeoutId) {
            waiters.delete(waiter)
            break
          }
        }
      }
      reject(new Error('Timeout waiting for code'))
    }, waitTimeout * 1000)

    const waiter: Waiter = {
      resolve,
      reject,
      timeoutId,
      markUsed,
      maxAgeSeconds: maxAge
    }
    const waiters = waitersByRule.get(rule.id) || new Set<Waiter>()
    waiters.add(waiter)
    waitersByRule.set(rule.id, waiters)
  })
}

export function getLatestEmailCode(siteKey: string) {
  const rule = getRuleBySiteKey(siteKey)
  if (!rule) return null
  const maxAge = rule.max_age_seconds || 300
  return getLatestCode(rule.id, maxAge)
}

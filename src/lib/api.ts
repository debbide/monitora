const API_URL = ''

export interface Monitor {
  id: string
  name: string
  url: string
  check_interval: number
  check_interval_max: number | null
  check_type: 'http' | 'tcp' | 'komari' | 'komari_webhook' | 'nezha_webhook' | 'telegram' | 'scheduled_webhook' | 'feedback_linkage' | 'email_code'
  check_method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH'
  check_timeout: number
  expected_status_codes: string
  expected_keyword: string | null
  forbidden_keyword: string | null
  komari_offline_threshold: number
  email_site_key?: string | null
  email_from_filter?: string | null
  email_subject_keyword?: string | null
  email_body_keyword?: string | null
  email_code_regex?: string | null
  email_to_email?: string | null
  email_timeout_seconds?: number | null
  email_max_age_seconds?: number | null
  check_content_type: string | null
  check_headers: string | null
  check_body: string | null
  tg_chat_id: string | null
  tg_server_name: string | null
  tg_offline_keywords: string | null
  tg_online_keywords: string | null
  tg_notify_chat_id: string | null
  webhook_url: string | null
  webhook_content_type: string
  webhook_headers: string | null
  webhook_body: string | null
  webhook_username: string | null
  next_check_at?: string
  is_active: number
  sort_order: number
  feedback_linkage: number
  feedback_threshold: number
  feedback_fluctuation_min: number | null
  feedback_fluctuation_max: number | null
  created_at: string
  updated_at: string
}

export interface MonitorCheck {
  id: number
  monitor_id: string
  status: 'up' | 'down'
  response_time: number
  status_code: number
  error_message: string
  checked_at: string
}

export interface Incident {
  id: number
  monitor_id: string
  started_at: string
  resolved_at: string | null
  duration_seconds: number
  notified: number
}

export interface KomariServer {
  name: string
  region: string
  updated_at: string
  minutes_ago: number
  is_online: boolean
}

export interface MonitorStats {
  total_checks: number
  uptime_percentage: number
  average_response_time: number
}

async function fetchAPI(path: string, options?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || 'Request failed')
  }

  return response.json()
}

export async function getMonitors(): Promise<Monitor[]> {
  return fetchAPI('/api/monitors')
}

export async function createMonitor(monitor: {
  name: string
  url?: string
  check_interval?: number
  check_interval_max?: number | null
  check_type?: 'http' | 'tcp' | 'komari' | 'komari_webhook' | 'nezha_webhook' | 'telegram' | 'scheduled_webhook' | 'feedback_linkage' | 'email_code'
  check_method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH'
  check_timeout?: number
  expected_status_codes?: string
  expected_keyword?: string
  forbidden_keyword?: string
  komari_offline_threshold?: number
  email_site_key?: string
  email_from_filter?: string
  email_subject_keyword?: string
  email_body_keyword?: string
  email_code_regex?: string
  email_to_email?: string
  email_timeout_seconds?: number
  email_max_age_seconds?: number
  check_content_type?: string
  check_headers?: string
  check_body?: string
  tg_chat_id?: string
  tg_server_name?: string
  tg_offline_keywords?: string
  tg_online_keywords?: string
  tg_notify_chat_id?: string
  webhook_url?: string
  webhook_content_type?: string
  webhook_headers?: Record<string, string>
  webhook_body?: Record<string, any>
  webhook_username?: string
  feedback_linkage?: boolean | number
  feedback_threshold?: number
  feedback_fluctuation_min?: number | null
  feedback_fluctuation_max?: number | null
}): Promise<Monitor> {
  return fetchAPI('/api/monitors', {
    method: 'POST',
    body: JSON.stringify(monitor),
  })
}

export async function deleteMonitor(id: string): Promise<void> {
  await fetchAPI(`/api/monitors/${id}`, {
    method: 'DELETE',
  })
}

export async function updateMonitor(id: string, monitor: {
  name: string
  url?: string
  check_interval?: number
  check_interval_max?: number | null
  check_type?: 'http' | 'tcp' | 'komari' | 'komari_webhook' | 'nezha_webhook' | 'telegram' | 'scheduled_webhook' | 'feedback_linkage' | 'email_code'
  check_method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH'
  check_timeout?: number
  expected_status_codes?: string
  expected_keyword?: string
  forbidden_keyword?: string
  komari_offline_threshold?: number
  email_site_key?: string
  email_from_filter?: string
  email_subject_keyword?: string
  email_body_keyword?: string
  email_code_regex?: string
  email_to_email?: string
  email_timeout_seconds?: number
  email_max_age_seconds?: number
  check_content_type?: string
  check_headers?: string
  check_body?: string
  tg_chat_id?: string
  tg_server_name?: string
  tg_offline_keywords?: string
  tg_online_keywords?: string
  tg_notify_chat_id?: string
  webhook_url?: string
  webhook_content_type?: string
  webhook_headers?: Record<string, string>
  webhook_body?: Record<string, any>
  webhook_username?: string
  is_active?: number
  feedback_linkage?: boolean | number
  feedback_threshold?: number
  feedback_fluctuation_min?: number | null
  feedback_fluctuation_max?: number | null
}): Promise<Monitor> {
  return fetchAPI(`/api/monitors/${id}`, {
    method: 'PUT',
    body: JSON.stringify(monitor),
  })
}

export async function getChecks(monitorId: string): Promise<MonitorCheck[]> {
  return fetchAPI(`/api/checks?monitor_id=${monitorId}`)
}

export async function getStats(monitorId: string): Promise<MonitorStats> {
  return fetchAPI(`/api/stats?monitor_id=${monitorId}`)
}

export async function testWebhook(monitorId: string): Promise<{ success: boolean; message: string }> {
  return fetchAPI('/api/test-webhook', {
    method: 'POST',
    body: JSON.stringify({ monitor_id: monitorId }),
  })
}

export async function checkNow(monitorId: string): Promise<{ success: boolean; check: MonitorCheck }> {
  return fetchAPI('/api/check-now', {
    method: 'POST',
    body: JSON.stringify({ monitor_id: monitorId }),
  })
}

export async function verifyPassword(password: string): Promise<boolean> {
  try {
    const result = await fetchAPI('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
    return result.valid === true
  } catch (error) {
    return false
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await fetchAPI('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })
}

export async function getKomariStatus(monitorId: string): Promise<{ servers: KomariServer[] }> {
  return fetchAPI(`/api/komari-status/${monitorId}`)
}

export async function reorderMonitors(orders: { id: string; sort_order: number }[]): Promise<void> {
  await fetchAPI('/api/monitors/reorder', {
    method: 'PUT',
    body: JSON.stringify({ orders }),
  })
}

// Telegram 设置
export interface TelegramStatus {
  enabled: boolean
  connected: boolean
  token: string
}

export async function getTelegramSettings(): Promise<TelegramStatus> {
  return fetchAPI('/api/settings/telegram')
}

export async function setTelegramToken(token: string): Promise<{ success: boolean; message: string }> {
  return fetchAPI('/api/settings/telegram', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export async function testTelegramChat(chatId: string): Promise<{ success: boolean; message: string }> {
  return fetchAPI('/api/settings/telegram/test-chat', {
    method: 'POST',
    body: JSON.stringify({ chat_id: chatId }),
  })
}

// Komari 通知配置
export interface KomariNotifySettings {
  enabled: boolean
  chat_id: string
  webhook_url: string
  webhook_body: string
}

export async function getKomariNotifySettings(): Promise<KomariNotifySettings> {
  return fetchAPI('/api/settings/komari-notify')
}

export async function saveKomariNotifySettings(settings: Partial<KomariNotifySettings>): Promise<{ success: boolean; message: string }> {
  return fetchAPI('/api/settings/komari-notify', {
    method: 'POST',
    body: JSON.stringify(settings),
  })
}

// Nezha 通知配置
export interface NezhaNotifySettings {
  enabled: boolean
  chat_id: string
}

export async function getNezhaNotifySettings(): Promise<NezhaNotifySettings> {
  return fetchAPI('/api/settings/nezha-notify')
}

export async function saveNezhaNotifySettings(settings: Partial<NezhaNotifySettings>): Promise<{ success: boolean; message: string }> {
  return fetchAPI('/api/settings/nezha-notify', {
    method: 'POST',
    body: JSON.stringify(settings),
  })
}

// WebTask 鉴权设置
export interface WebtaskSettings {
  enabled: boolean
  has_key: boolean
}

export async function getWebtaskSettings(): Promise<WebtaskSettings> {
  return fetchAPI('/api/settings/webtask')
}

export async function saveWebtaskSettings(settings: {
  enabled: boolean
  api_key?: string
}): Promise<{ success: boolean; message: string }> {
  return fetchAPI('/api/settings/webtask', {
    method: 'POST',
    body: JSON.stringify(settings),
  })
}

// Email 验证码设置
export interface EmailSettings {
  enabled: boolean
  host: string
  port: number
  user: string
  tls: boolean
  has_password: boolean
  connected: boolean
  last_error: string
  last_sync_at: string
}

export interface EmailRule {
  id: string
  site_key: string
  from_filter: string
  subject_keyword: string | null
  body_keyword: string | null
  code_regex: string
  to_email: string | null
  timeout_seconds: number
  max_age_seconds: number
  enabled: number
  created_at: string
  updated_at: string
}

export async function getEmailSettings(): Promise<EmailSettings> {
  return fetchAPI('/api/settings/email')
}

export async function saveEmailSettings(settings: {
  enabled: boolean
  host: string
  port: number
  user: string
  password?: string
  tls: boolean
}): Promise<{ success: boolean; message: string }> {
  return fetchAPI('/api/settings/email', {
    method: 'POST',
    body: JSON.stringify(settings),
  })
}

export async function getEmailRules(): Promise<EmailRule[]> {
  return fetchAPI('/api/email-rules')
}

export async function createEmailRule(rule: {
  site_key: string
  from_filter: string
  subject_keyword?: string | null
  body_keyword?: string | null
  code_regex: string
  to_email?: string | null
  timeout_seconds?: number
  max_age_seconds?: number
  enabled?: boolean
}): Promise<EmailRule> {
  return fetchAPI('/api/email-rules', {
    method: 'POST',
    body: JSON.stringify(rule),
  })
}

export async function updateEmailRule(id: string, rule: {
  site_key: string
  from_filter: string
  subject_keyword?: string | null
  body_keyword?: string | null
  code_regex: string
  to_email?: string | null
  timeout_seconds?: number
  max_age_seconds?: number
  enabled?: boolean
}): Promise<EmailRule> {
  return fetchAPI(`/api/email-rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(rule),
  })
}

export async function deleteEmailRule(id: string): Promise<{ success: boolean }> {
  return fetchAPI(`/api/email-rules/${id}`, {
    method: 'DELETE',
  })
}

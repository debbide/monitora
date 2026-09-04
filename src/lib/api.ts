import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

const API_URL = ''

type HeaderInput = Record<string, string> | string

export interface Monitor {
  id: string
  name: string
  url: string
  check_interval: number
  check_interval_max: number | null
  check_type: 'http' | 'tcp' | 'komari' | 'komari_webhook' | 'nezha_webhook' | 'telegram' | 'scheduled_webhook' | 'feedback_linkage' | 'email_code'
  check_method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH'
  check_timeout: number
  http_client_mode: 'fetch' | 'curl'
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
  daily_window_start?: string | null
  daily_window_end?: string | null
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
  webhook_method: 'POST' | 'PUT' | 'PATCH' | 'GET'
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
  feedback_unit?: string | null
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
  const token = localStorage.getItem('monitor_auth_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    // If it's a 401 Unauthorized, token might be expired.
    // Clear it and reload the page to force login.
    localStorage.removeItem('monitor_auth_token')
    localStorage.removeItem('monitor_auth_expiry')
    window.location.reload()
    throw new Error('Authentication expired')
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || 'Request failed')
  }

  return response.json()
}

async function fetchPublicAuthAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    },
  })

  const result = await response.json().catch(() => ({ error: 'Request failed' }))
  if (!response.ok) {
    throw new Error(result.error || 'Request failed')
  }
  return result as T
}

export async function downloadAPI(path: string, options?: RequestInit): Promise<Blob> {
  const token = localStorage.getItem('monitor_auth_token')
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    localStorage.removeItem('monitor_auth_token')
    localStorage.removeItem('monitor_auth_expiry')
    window.location.reload()
    throw new Error('Authentication expired')
  }

  if (!response.ok) {
    throw new Error('Download failed')
  }

  return response.blob()
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
  http_client_mode?: 'fetch' | 'curl'
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
  check_headers?: HeaderInput
  check_body?: string
  tg_chat_id?: string
  tg_server_name?: string
  tg_offline_keywords?: string
  tg_online_keywords?: string
  tg_notify_chat_id?: string
  webhook_url?: string
  webhook_content_type?: string
  webhook_method?: 'POST' | 'PUT' | 'PATCH' | 'GET'
  webhook_headers?: HeaderInput
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
  http_client_mode?: 'fetch' | 'curl'
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
  check_headers?: HeaderInput
  check_body?: string
  tg_chat_id?: string
  tg_server_name?: string
  tg_offline_keywords?: string
  tg_online_keywords?: string
  tg_notify_chat_id?: string
  webhook_url?: string
  webhook_content_type?: string
  webhook_method?: 'POST' | 'PUT' | 'PATCH' | 'GET'
  webhook_headers?: HeaderInput
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

export async function getFeedbackCallbackSettings(): Promise<{ webhook_token: string }> {
  return fetchAPI('/api/settings/feedback-callback')
}

export async function regenerateFeedbackCallbackToken(): Promise<{ webhook_token: string }> {
  return fetchAPI('/api/settings/feedback-callback/regenerate-token', {
    method: 'POST',
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

export interface LoginResponse {
  valid: boolean
  token?: string
  twoFactor?: {
    required: boolean
    ticket: string
  }
}

export interface TwoFactorStatus {
  totp_enabled: boolean
  passkeys: Array<{
    id: number
    name: string
    created_at: string
  }>
}

export interface TotpSetupResponse {
  secret: string
  setup_token: string
  otpauth_url: string
}

export interface TwoFactorAccessResponse {
  access_token: string
  expires_at: string
}

export class TwoFactorAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TwoFactorAccessError'
  }
}

async function fetchTwoFactorAPI<T>(path: string, accessToken: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('monitor_auth_token')
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-2FA-Access-Token': accessToken,
      ...(options?.headers as Record<string, string>),
    },
  })

  const result = await response.json().catch(() => ({ error: 'Request failed' }))
  if (response.status === 403 && result.code === 'TWO_FACTOR_ACCESS_EXPIRED') {
    throw new TwoFactorAccessError(result.error || '安全验证已过期，请重新输入当前密码')
  }
  if (response.status === 401) {
    localStorage.removeItem('monitor_auth_token')
    localStorage.removeItem('monitor_auth_expiry')
    window.location.reload()
    throw new Error('Authentication expired')
  }
  if (!response.ok) {
    throw new Error(result.error || 'Request failed')
  }
  return result as T
}

export async function verifyPassword(password: string): Promise<LoginResponse> {
  try {
    return await fetchPublicAuthAPI<LoginResponse>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
  } catch (error) {
    return { valid: false }
  }
}

export async function verifyTotpLogin(ticket: string, code: string): Promise<LoginResponse> {
  return fetchPublicAuthAPI<LoginResponse>('/api/auth/totp/verify', {
    method: 'POST',
    body: JSON.stringify({ ticket, code }),
  })
}

export async function unlockTwoFactorSettings(password: string): Promise<TwoFactorAccessResponse> {
  return fetchAPI('/api/auth/2fa/access', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export async function getTwoFactorStatus(accessToken: string): Promise<TwoFactorStatus> {
  return fetchTwoFactorAPI('/api/auth/2fa/status', accessToken)
}

export async function beginTotpSetup(accessToken: string): Promise<TotpSetupResponse> {
  return fetchTwoFactorAPI('/api/auth/2fa/totp/setup', accessToken, {
    method: 'POST',
  })
}

export async function confirmTotpSetup(
  accessToken: string,
  setupToken: string,
  secret: string,
  code: string
): Promise<{ success: boolean }> {
  return fetchTwoFactorAPI('/api/auth/2fa/totp/confirm', accessToken, {
    method: 'POST',
    body: JSON.stringify({ setup_token: setupToken, secret, code }),
  })
}

export async function disableTotp(accessToken: string): Promise<{ success: boolean }> {
  return fetchTwoFactorAPI('/api/auth/2fa/totp/disable', accessToken, {
    method: 'POST',
  })
}

export async function beginPasskeyRegistration(
  accessToken: string,
  name: string
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return fetchTwoFactorAPI<PublicKeyCredentialCreationOptionsJSON>('/api/auth/2fa/passkey/register/challenge', accessToken, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function finishPasskeyRegistration(accessToken: string, challenge: string, response: unknown) {
  return fetchTwoFactorAPI('/api/auth/2fa/passkey/register/verify', accessToken, {
    method: 'POST',
    body: JSON.stringify({ challenge, response }),
  })
}

export async function deletePasskey(id: number, accessToken: string): Promise<{ success: boolean }> {
  return fetchTwoFactorAPI(`/api/auth/2fa/passkey/${id}`, accessToken, {
    method: 'DELETE',
  })
}

export async function beginPasskeyLogin(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return fetchPublicAuthAPI<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkey/login/challenge', {
    method: 'POST',
  })
}

export async function finishPasskeyLogin(challenge: string, response: unknown): Promise<LoginResponse> {
  return fetchPublicAuthAPI<LoginResponse>('/api/auth/passkey/login/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge, response }),
  })
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
  webhook_token: string
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

export async function regenerateKomariNotifyToken(): Promise<{ webhook_token: string }> {
  return fetchAPI('/api/settings/komari-notify/regenerate-token', {
    method: 'POST',
  })
}

// Nezha 通知配置
export interface NezhaNotifySettings {
  enabled: boolean
  chat_id: string
  webhook_token: string
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

export async function regenerateNezhaNotifyToken(): Promise<{ webhook_token: string }> {
  return fetchAPI('/api/settings/nezha-notify/regenerate-token', {
    method: 'POST',
  })
}

// WebTask 鉴权设置
export interface WebtaskSettings {
  enabled: boolean
  has_key: boolean
  api_key?: string
}

export async function getWebtaskSettings(includeKey?: boolean): Promise<WebtaskSettings> {
  const query = includeKey ? '?include_key=1' : ''
  return fetchAPI(`/api/settings/webtask${query}`)
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


// ---------------- 备份与恢复 ----------------

export async function getBackupSettings() {
  return fetchAPI('/api/backup/settings')
}

export async function saveBackupSettings(settings: Record<string, any>) {
  return fetchAPI('/api/backup/settings', {
    method: 'POST',
    body: JSON.stringify(settings)
  })
}

export async function triggerBackup() {
  return fetchAPI('/api/backup/trigger', {
    method: 'POST'
  })
}

export async function restoreBackup(file: File) {
  const token = localStorage.getItem('monitor_auth_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // Convert File to Base64
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Extract the base64 part after the comma if it's a data URL
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = error => reject(error)
    reader.readAsDataURL(file)
  })

  const response = await fetch(`${API_URL}/api/backup/restore`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: base64Data })
  })
  if (!response.ok) {
    let errMsg = ''
    try {
      const err = await response.json()
      errMsg = err.error
    } catch (e) {
      // response wasn't JSON
    }
    throw new Error(errMsg || `上传恢复失败 (HTTP ${response.status} ${response.statusText})`)
  }
  return response.json()
}

export interface Monitor {
  id: string
  name: string
  url: string
  check_interval: number
  check_interval_max: number | null  // HTTP模式随机间隔最大值
  check_type: 'http' | 'tcp' | 'komari' | 'komari_webhook' | 'nezha_webhook' | 'telegram' | 'scheduled_webhook' | 'feedback_linkage' | 'email_code'
  check_method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH'
  check_timeout: number
  http_client_mode: 'fetch' | 'curl'
  expected_status_codes: string
  expected_keyword: string | null
  forbidden_keyword: string | null
  komari_offline_threshold?: number
  email_site_key?: string | null
  email_from_filter?: string | null
  email_subject_keyword?: string | null
  email_body_keyword?: string | null
  email_code_regex?: string | null
  email_to_email?: string | null
  email_timeout_seconds?: number | null
  email_max_age_seconds?: number | null
  daily_window_start?: string | null // 格式 'HH:mm'
  daily_window_end?: string | null // 格式 'HH:mm'
  check_content_type?: string | null
  check_headers?: string | null
  check_body?: string | null
  next_check_at?: string
  // Telegram 相关字段
  tg_chat_id: string | null
  tg_server_name: string | null  // 用于消息匹配的服务器名称
  tg_offline_keywords: string | null
  tg_online_keywords: string | null
  tg_notify_chat_id: string | null  // 用于 Komari 监控的 TG 群组通知
  webhook_url: string | null
  webhook_content_type: string
  webhook_method: 'POST' | 'PUT' | 'PATCH' | 'GET'
  webhook_headers: string | null
  webhook_body: string | null
  webhook_username: string | null
  is_active: number
  sort_order: number
  feedback_linkage: number  // 是否开启反馈联动
  feedback_threshold: number // 续期窗口阈值 (小时)
  feedback_fluctuation_min: number | null // 执行波动范围 - 最小 (小时)
  feedback_fluctuation_max: number | null // 执行波动范围 - 最大 (小时)
  created_at: string
  updated_at: string
}


export interface MonitorCheck {
  id?: number
  monitor_id: string
  status: 'up' | 'down'
  response_time: number
  status_code: number
  error_message: string
  checked_at: string
}

export interface KomariServer {
  uuid: string
  name: string
  region: string
  updated_at: string
}

export interface KomariApiResponse {
  status: string
  message: string
  data: KomariServer[]
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

export interface EmailCode {
  id?: number
  rule_id: string
  code: string
  message_id?: string | null
  from_address?: string | null
  subject?: string | null
  received_at?: string | null
  used?: number
  created_at?: string
}

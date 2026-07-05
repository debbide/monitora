import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import type { RawData } from 'ws'
import type { IncomingMessage } from 'http'
import { initDatabase, queryAll, queryFirst, run, saveNow, cleanOldData } from './db.js'
import { generateToken, requireAuth } from './auth.js'
import { Monitor, MonitorCheck } from './types.js'
import {
  checkAllMonitors,
  checkMonitor,
  hashPassword,
  verifyPassword,
  saveCheck,
  handleDownStatus,
  handleUpStatus,
  calculateNextDailyWindowTime
} from './monitor.js'
import { getWebhookMethod, processWebhookBody, sendWebhookNotification } from './webhook-sender.js'
import { normalizeHeadersForStorage, normalizeJsonForStorage, parseStoredHeaders } from './header-utils.js'
import {
  initTelegramBot,
  getTelegramBotStatus,
  stopTelegramBot,
  setTgBotToken,
  getTgBotToken,
  testChatConnection,
  sendTgMessage
} from './telegram.js'
import { addClient, broadcastRefresh, getClientCount, getClients, pollRefresh } from './sse.js'
import { initBackupScheduler, performBackup } from './backup.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

function getHttpClientMode(mode: unknown): 'fetch' | 'curl' {
  return mode === 'curl' ? 'curl' : 'fetch'
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/━+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

app.use(cors())
app.use(express.json({ limit: '100mb' }))

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')))

// 健康检查端点
const startTime = Date.now()
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage().heapUsed
  })
})

// API 鉴权中间件拦截
app.use('/api', (req, res, next) => {
  const publicPaths = [
    '/auth/verify',
    '/komari-notify',
    '/webhook/komari',
    '/komari-status',
    '/nezha-notify-v1',
    '/callback',
    '/webtask',
    '/sse/status'
  ]
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next()
  }
  return requireAuth(req, res, next)
})

// API 路由
app.get('/api/monitors', (req, res) => {
  try {
    const monitors = queryAll('SELECT * FROM monitors ORDER BY sort_order ASC, created_at DESC')
    res.json(monitors)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/monitors', async (req, res) => {
  try {
    const body = req.body
    const id = crypto.randomUUID()

    // 计算初始 next_check_at (延迟首次执行)
    const now = Date.now()
    const checkInterval = parseInt(body.check_interval) || 5
    const checkIntervalMax = body.check_interval_max ? parseInt(body.check_interval_max) : null
    let nextInterval = checkInterval

    if (
      (body.check_type === 'http' || body.check_type === 'scheduled_webhook') &&
      checkIntervalMax &&
      checkIntervalMax > checkInterval
    ) {
      nextInterval =
        Math.floor(Math.random() * (checkIntervalMax - checkInterval + 1)) + checkInterval
    }
    let initialNextCheck = new Date(now + nextInterval * 60 * 1000).toISOString()
    if (body.daily_window_start && body.daily_window_end) {
      initialNextCheck = calculateNextDailyWindowTime(body.daily_window_start, body.daily_window_end, true)
    }

    if (body.check_type === 'email_code') {
      if (!body.email_site_key || !body.email_from_filter || !body.email_code_regex) {
        return res
          .status(400)
          .json({ error: 'email_site_key, email_from_filter, email_code_regex required' })
      }
    }

    const checkHeaders = normalizeHeadersForStorage(body.check_headers)
    const webhookHeaders = normalizeHeadersForStorage(body.webhook_headers)
    const checkBody = normalizeJsonForStorage(body.check_body)
    const webhookBody = normalizeJsonForStorage(body.webhook_body)

    run(
      `INSERT INTO monitors (
        id, name, url, check_interval, check_interval_max, check_type, check_method, check_timeout,
        http_client_mode, expected_status_codes, expected_keyword, forbidden_keyword, komari_offline_threshold,
        email_site_key, email_from_filter, email_subject_keyword, email_body_keyword, email_code_regex,
        email_to_email, email_timeout_seconds, email_max_age_seconds, daily_window_start, daily_window_end,
        check_content_type, check_headers, check_body,
        tg_chat_id, tg_server_name, tg_offline_keywords, tg_online_keywords, tg_notify_chat_id,
        webhook_url, webhook_content_type, webhook_method, webhook_headers, webhook_body, webhook_username,
        next_check_at, is_active, feedback_linkage, feedback_threshold,
        feedback_fluctuation_min, feedback_fluctuation_max
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        body.url || '',
        checkInterval,
        checkIntervalMax,
        body.check_type || 'http',
        body.check_method || 'GET',
        parseInt(body.check_timeout) || 30,
        getHttpClientMode(body.http_client_mode),
        body.expected_status_codes || '200,201,204,301,302',
        body.expected_keyword || null,
        body.forbidden_keyword || null,
        parseInt(body.komari_offline_threshold) || 3,
        body.email_site_key || null,
        body.email_from_filter || null,
        body.email_subject_keyword || null,
        body.email_body_keyword || null,
        body.email_code_regex || null,
        body.email_to_email || null,
        parseInt(body.email_timeout_seconds) || 120,
        parseInt(body.email_max_age_seconds) || 300,
        body.daily_window_start || null,
        body.daily_window_end || null,
        body.check_content_type || 'application/json',
        checkHeaders,
        checkBody,
        body.tg_chat_id || null,
        body.tg_server_name || null,
        body.tg_offline_keywords || null,
        body.tg_online_keywords || null,
        body.tg_notify_chat_id || null,
        body.webhook_url || null,
        body.webhook_content_type || 'application/json',
        getWebhookMethod(body.webhook_method),
        webhookHeaders,
        webhookBody,
        body.webhook_username || null,
        initialNextCheck,
        1,
        body.feedback_linkage || body.check_type === 'feedback_linkage' ? 1 : 0,
        parseFloat(body.feedback_threshold) || 0,
        parseFloat(body.feedback_fluctuation_min) || 0,
        parseFloat(body.feedback_fluctuation_max) || 0
      ]
    )

    const monitor = queryFirst('SELECT * FROM monitors WHERE id = ?', [id]) as Monitor

    // 不再立即执行 checkMonitor(monitor)，而是等待 next_check_at
    if (monitor) {
      if (
        monitor.check_type === 'telegram' ||
        monitor.check_type === 'komari_webhook' ||
        monitor.check_type === 'nezha_webhook'
      ) {
        // ... (保持不变) ...
        run(
          `INSERT INTO monitor_checks (monitor_id, status, response_time, status_code, error_message, checked_at)
           VALUES (?, 'up', 0, 0, NULL, datetime('now'))`,
          [id]
        )
      }
    }

    if (body.check_type === 'email_code') {
      run(
        `INSERT OR REPLACE INTO email_rules (
          id, site_key, from_filter, subject_keyword, body_keyword, code_regex, to_email,
          timeout_seconds, max_age_seconds, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          id,
          body.email_site_key,
          body.email_from_filter,
          body.email_subject_keyword || null,
          body.email_body_keyword || null,
          body.email_code_regex,
          body.email_to_email || null,
          parseInt(body.email_timeout_seconds) || 120,
          parseInt(body.email_max_age_seconds) || 300,
          1
        ]
      )
    }

    res.status(201).json(monitor)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// 批量更新排序 - 必须放在 /api/monitors/:id 之前
app.put('/api/monitors/reorder', (req, res) => {
  try {
    const { orders } = req.body as { orders: { id: string; sort_order: number }[] }

    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'orders array required' })
    }

    for (const item of orders) {
      run('UPDATE monitors SET sort_order = ? WHERE id = ?', [item.sort_order, item.id])
    }

    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/monitors/:id', (req, res) => {
  try {
    const { id } = req.params
    const body = req.body

    // 计算新的 next_check_at (修改后重置计时)
    const now = Date.now()
    const checkInterval = parseInt(body.check_interval) || 5
    const checkIntervalMax = body.check_interval_max ? parseInt(body.check_interval_max) : null
    let nextInterval = checkInterval

    if (
      (body.check_type === 'http' || body.check_type === 'scheduled_webhook') &&
      checkIntervalMax &&
      checkIntervalMax > checkInterval
    ) {
      nextInterval =
        Math.floor(Math.random() * (checkIntervalMax - checkInterval + 1)) + checkInterval
    }
    let resetNextCheck = new Date(now + nextInterval * 60 * 1000).toISOString()
    if (body.daily_window_start && body.daily_window_end) {
      resetNextCheck = calculateNextDailyWindowTime(body.daily_window_start, body.daily_window_end, true)
    }

    if (body.check_type === 'email_code') {
      if (!body.email_site_key || !body.email_from_filter || !body.email_code_regex) {
        return res
          .status(400)
          .json({ error: 'email_site_key, email_from_filter, email_code_regex required' })
      }
    }

    const checkHeaders = normalizeHeadersForStorage(body.check_headers)
    const webhookHeaders = normalizeHeadersForStorage(body.webhook_headers)
    const checkBody = normalizeJsonForStorage(body.check_body)
    const webhookBody = normalizeJsonForStorage(body.webhook_body)

    run(
      `UPDATE monitors SET
        name = ?,
        url = ?,
        check_interval = ?,
        check_interval_max = ?,
        check_type = ?,
        check_method = ?,
        check_timeout = ?,
        http_client_mode = ?,
        expected_status_codes = ?,
        expected_keyword = ?,
        forbidden_keyword = ?,
        komari_offline_threshold = ?,
        email_site_key = ?,
        email_from_filter = ?,
        email_subject_keyword = ?,
        email_body_keyword = ?,
        email_code_regex = ?,
        email_to_email = ?,
        email_timeout_seconds = ?,
        email_max_age_seconds = ?,
        daily_window_start = ?,
        daily_window_end = ?,
        check_content_type = ?,
        check_headers = ?,
        check_body = ?,
        tg_chat_id = ?,
        tg_server_name = ?,
        tg_offline_keywords = ?,
        tg_online_keywords = ?,
        tg_notify_chat_id = ?,
        webhook_url = ?,
        webhook_content_type = ?,
        webhook_method = ?,
        webhook_headers = ?,
        webhook_body = ?,
        webhook_username = ?,
        is_active = ?,
        updated_at = ?,
        next_check_at = ?,
        feedback_linkage = ?,
        feedback_threshold = ?,
        feedback_fluctuation_min = ?,
        feedback_fluctuation_max = ?
      WHERE id = ?`,
      [
        body.name,
        body.url || '',
        checkInterval,
        checkIntervalMax,
        body.check_type || 'http',
        body.check_method || 'GET',
        parseInt(body.check_timeout) || 30,
        getHttpClientMode(body.http_client_mode),
        body.expected_status_codes || '200,201,204,301,302',
        body.expected_keyword || null,
        body.forbidden_keyword || null,
        parseInt(body.komari_offline_threshold) || 3,
        body.email_site_key || null,
        body.email_from_filter || null,
        body.email_subject_keyword || null,
        body.email_body_keyword || null,
        body.email_code_regex || null,
        body.email_to_email || null,
        parseInt(body.email_timeout_seconds) || 120,
        parseInt(body.email_max_age_seconds) || 300,
        body.daily_window_start || null,
        body.daily_window_end || null,
        body.check_content_type || 'application/json',
        checkHeaders,
        checkBody,
        body.tg_chat_id || null,
        body.tg_server_name || null,
        body.tg_offline_keywords || null,
        body.tg_online_keywords || null,
        body.tg_notify_chat_id || null,
        body.webhook_url || null,
        body.webhook_content_type || 'application/json',
        getWebhookMethod(body.webhook_method),
        webhookHeaders,
        webhookBody,
        body.webhook_username || null,
        body.is_active !== undefined ? body.is_active : 1,
        new Date().toISOString(),
        resetNextCheck,
        body.feedback_linkage || body.check_type === 'feedback_linkage' ? 1 : 0,
        parseFloat(body.feedback_threshold) || 0,
        parseFloat(body.feedback_fluctuation_min) || 0,
        parseFloat(body.feedback_fluctuation_max) || 0,
        id
      ]
    )

    if (body.check_type === 'email_code') {
      run(
        `INSERT OR REPLACE INTO email_rules (
          id, site_key, from_filter, subject_keyword, body_keyword, code_regex, to_email,
          timeout_seconds, max_age_seconds, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          id,
          body.email_site_key,
          body.email_from_filter,
          body.email_subject_keyword || null,
          body.email_body_keyword || null,
          body.email_code_regex,
          body.email_to_email || null,
          parseInt(body.email_timeout_seconds) || 120,
          parseInt(body.email_max_age_seconds) || 300,
          body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1
        ]
      )
    } else {
      run('DELETE FROM email_rules WHERE id = ?', [id])
    }

    const monitor = queryFirst('SELECT * FROM monitors WHERE id = ?', [id])
    res.json(monitor)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/monitors/:id', (req, res) => {
  try {
    const { id } = req.params
    run('DELETE FROM monitors WHERE id = ?', [id])
    run('DELETE FROM email_rules WHERE id = ?', [id])
    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/checks', (req, res) => {
  try {
    const monitorId = req.query.monitor_id as string
    if (!monitorId) {
      return res.status(400).json({ error: 'monitor_id required' })
    }

    const checks = queryAll(
      'SELECT * FROM monitor_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 100',
      [monitorId]
    )

    res.json(checks)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/stats', (req, res) => {
  try {
    const monitorId = req.query.monitor_id as string
    if (!monitorId) {
      return res.status(400).json({ error: 'monitor_id required' })
    }

    const total = queryFirst('SELECT COUNT(*) as count FROM monitor_checks WHERE monitor_id = ?', [
      monitorId
    ]) as any

    const upCount = queryFirst(
      "SELECT COUNT(*) as count FROM monitor_checks WHERE monitor_id = ? AND status = 'up'",
      [monitorId]
    ) as any

    const avgResponseTime = queryFirst(
      'SELECT AVG(response_time) as avg FROM monitor_checks WHERE monitor_id = ?',
      [monitorId]
    ) as any

    const uptime = total.count > 0 ? (upCount.count / total.count) * 100 : 0

    res.json({
      total_checks: total.count,
      uptime_percentage: uptime,
      average_response_time: avgResponseTime.avg || 0
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/test-webhook', async (req, res) => {
  try {
    const { monitor_id } = req.body
    const monitor = queryFirst('SELECT * FROM monitors WHERE id = ?', [monitor_id]) as Monitor

    if (!monitor) {
      return res.status(404).json({ error: 'Monitor not found' })
    }

    if (!monitor.webhook_url) {
      return res.status(400).json({ error: 'No webhook URL configured' })
    }

    const testCheck: MonitorCheck = {
      monitor_id: monitor.id,
      status: 'up',
      response_time: 123,
      status_code: 200,
      error_message: '',
      checked_at: new Date().toISOString()
    }

    // 发送测试 webhook
    const variables = {
      monitor_name: monitor.name,
      monitor_url: monitor.url,
      status: 'down',
      error: 'Test notification',
      timestamp: testCheck.checked_at,
      response_time: testCheck.response_time.toString(),
      status_code: testCheck.status_code.toString()
    }

    let payload: any
    let headers: Record<string, string> = {}

    if (monitor.webhook_body) {
      const body = JSON.parse(monitor.webhook_body)
      payload = processWebhookBody(body, variables)
    } else {
      payload = {
        monitor: monitor.name,
        url: monitor.url,
        status: 'down',
        timestamp: testCheck.checked_at,
        response_time: testCheck.response_time,
        status_code: testCheck.status_code,
        error: 'Test notification',
        message: `🚨 ${monitor.name} is DOWN! Test notification`
      }
    }

    headers['Content-Type'] = monitor.webhook_content_type || 'application/json'

    if (monitor.webhook_headers) {
      headers = { ...headers, ...parseStoredHeaders(monitor.webhook_headers) }
    }

    if (monitor.webhook_username) {
      const encodedAuth = Buffer.from(`${monitor.webhook_username}:`).toString('base64')
      headers['Authorization'] = `Basic ${encodedAuth}`
    }

    const webhookMethod = getWebhookMethod(monitor.webhook_method)
    await fetch(monitor.webhook_url, {
      method: webhookMethod,
      headers,
      body: webhookMethod === 'GET' ? undefined : JSON.stringify(payload)
    })

    // 如果是 Telegram 类型，向群组发送确认消息
    if (monitor.check_type === 'telegram' && monitor.tg_chat_id) {
      try {
        const webhookConfirmMsg = [
          `📤 **Webhook 测试成功**`,
          `📊 监控: ${monitor.name}`,
          `🔗 Webhook 已发送测试通知`,
          `⏰ ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
        ].join('\n')
        await sendTgMessage(monitor.tg_chat_id, webhookConfirmMsg, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 重发 Webhook', callback_data: `retry_webhook:${monitor.id}` }]
            ]
          }
        })
      } catch (err) {
        console.error('发送 TG 确认消息失败:', err)
      }
    }

    // 如果是 Komari Webhook 类型，使用全局通知群组发送确认消息
    if (monitor.check_type === 'komari_webhook') {
      try {
        const chatIdResult = queryFirst(
          "SELECT value FROM system_settings WHERE key = 'komari_notify_chat_id'"
        ) as { value: string } | null
        const chatId = chatIdResult?.value || ''
        if (chatId) {
          const webhookConfirmMsg = [
            `📤 *Webhook 测试成功*`,
            ``,
            `🖥️ *监控:* ${monitor.name}`,
            `🔗 *Webhook:* ${monitor.webhook_url.substring(0, 50)}...`,
            ``,
            `\`⏰ ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\``
          ].join('\n')
          await sendTgMessage(chatId, webhookConfirmMsg, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 重发 Webhook', callback_data: `retry_webhook:${monitor.id}` }]
              ]
            }
          })
        }
      } catch (err) {
        console.error('发送 Komari Webhook TG 确认消息失败:', err)
      }
    }

    // 如果是 Nezha Webhook 类型，使用全局通知群组发送确认消息
    if (monitor.check_type === 'nezha_webhook') {
      try {
        const chatIdResult = queryFirst(
          "SELECT value FROM system_settings WHERE key = 'nezha_notify_chat_id'"
        ) as { value: string } | null
        const chatId = chatIdResult?.value || ''
        if (chatId) {
          const webhookConfirmMsg = [
            `📤 *Webhook 测试成功*`,
            ``,
            `🖥️ *监控:* ${monitor.name}`,
            `🔗 *Webhook:* ${monitor.webhook_url.substring(0, 50)}...`,
            ``,
            `\`⏰ ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\``
          ].join('\n')
          await sendTgMessage(chatId, webhookConfirmMsg, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 重发 Webhook', callback_data: `retry_webhook:${monitor.id}` }]
              ]
            }
          })
        }
      } catch (err) {
        console.error('发送 Nezha Webhook TG 确认消息失败:', err)
      }
    }

    res.json({ success: true, message: 'Test webhook sent' })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// processWebhookBody 已从 monitor.js 导入

app.post('/api/check-now', async (req, res) => {
  try {
    const { monitor_id } = req.body
    const monitor = queryFirst('SELECT * FROM monitors WHERE id = ?', [monitor_id]) as Monitor

    if (!monitor) {
      return res.status(404).json({ error: 'Monitor not found' })
    }

    await checkMonitor(monitor)

    const latestCheck = queryFirst(
      'SELECT * FROM monitor_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1',
      [monitor_id]
    )

    res.json({ success: true, check: latestCheck })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { password } = req.body
    const result = queryFirst('SELECT password_hash FROM admin_credentials LIMIT 1') as any

    if (!result) {
      return res.status(500).json({ error: 'No admin credentials found' })
    }

    const isValid = await verifyPassword(password, result.password_hash)

    if (isValid) {
      const token = generateToken()
      res.json({ valid: true, token })
    } else {
      res.status(401).json({ valid: false })
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { current_password, new_password } = req.body
    const result = queryFirst('SELECT password_hash FROM admin_credentials LIMIT 1') as any

    if (!result) {
      return res.status(500).json({ error: 'No admin credentials found' })
    }

    const isValid = await verifyPassword(current_password, result.password_hash)

    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }

    const newHash = await hashPassword(new_password)

    run('UPDATE admin_credentials SET password_hash = ?, updated_at = ? WHERE id = 1', [
      newHash,
      new Date().toISOString()
    ])

    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// 获取 TG Bot 设置和状态
app.get('/api/settings/telegram', (req, res) => {
  try {
    const status = getTelegramBotStatus()
    res.json(status)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// 设置 TG Bot Token
app.post('/api/settings/telegram', async (req, res) => {
  try {
    const { token } = req.body
    const result = await setTgBotToken(token || '')
    res.json(result)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// 测试群组连通性
app.post('/api/settings/telegram/test-chat', async (req, res) => {
  try {
    const { chat_id } = req.body
    const result = await testChatConnection(chat_id)
    res.json(result)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// ==================== WebTask 鉴权设置 ====================

app.get('/api/settings/webtask', (req, res) => {
  try {
    const enabled = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'webtask_auth_enabled'"
    ) as { value: string } | null
    const apiKey = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'webtask_api_key'"
    ) as { value: string } | null

    res.json({
      enabled: enabled?.value === '1',
      has_key: !!apiKey?.value,
      api_key: req.query.include_key === '1' ? apiKey?.value || '' : undefined
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/settings/webtask', (req, res) => {
  try {
    const { enabled, api_key } = req.body

    run(
      "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('webtask_auth_enabled', ?, datetime('now'))",
      [enabled ? '1' : '0']
    )

    if (api_key !== undefined) {
      run(
        "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('webtask_api_key', ?, datetime('now'))",
        [api_key || '']
      )
    }

    res.json({ success: true, message: 'WebTask 鉴权设置已保存' })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

function requireWebtaskAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const result = authenticateWebtaskRequest(req.headers, req.query, req.body)
  if (!result.ok) {
    return res.status(401).json({ error: result.error })
  }
  return next()
}

function authenticateWebtaskRequest(
  headers: Record<string, unknown>,
  query: Record<string, unknown>,
  body?: Record<string, unknown>
): { ok: boolean; error?: string } {
  const enabled = queryFirst(
    "SELECT value FROM system_settings WHERE key = 'webtask_auth_enabled'"
  ) as { value: string } | null
  if (enabled?.value !== '1') {
    return { ok: true }
  }
  const apiKeyRow = queryFirst(
    "SELECT value FROM system_settings WHERE key = 'webtask_api_key'"
  ) as { value: string } | null
  const expected = apiKeyRow?.value || ''
  if (!expected) {
    return { ok: false, error: 'WebTask auth key not configured' }
  }
  const headerKey = String(headers['x-api-key'] || '')
  const authHeader = String(headers.authorization || '')
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  const bearerKey = bearerMatch ? bearerMatch[1].trim() : ''
  const queryKey = String(query.api_key || '')
  const bodyKey = String(body?.api_key || '')
  const provided = headerKey || bearerKey || queryKey || bodyKey
  if (provided !== expected) {
    return { ok: false, error: 'Invalid API key' }
  }
  return { ok: true }
}

const WEBTASK_LEASE_SECONDS = 180
const WEBTASK_MAX_ATTEMPTS_DEFAULT = 3
const WEBTASK_BACKOFF_BASE_SECONDS = 15
const wsClients = new Map<string, Set<WebSocket>>()

function nowIso(): string {
  return new Date().toISOString()
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString()
}

function upsertWebtaskClient(clientId: string, connected: boolean, req?: IncomingMessage) {
  if (!clientId) {
    return
  }
  const userAgent = String(req?.headers['user-agent'] || '')
  const remoteAddr = String(req?.socket?.remoteAddress || '')
  run(
    `INSERT INTO webtask_clients (client_id, last_seen_at, connected, user_agent, remote_addr, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       connected = excluded.connected,
       user_agent = excluded.user_agent,
       remote_addr = excluded.remote_addr,
       updated_at = excluded.updated_at`,
    [clientId, nowIso(), connected ? 1 : 0, userAgent, remoteAddr, nowIso()]
  )
}

function notifyTaskAvailable(targetClientId?: string | null) {
  const payload = JSON.stringify({ type: 'task_available', ts: Date.now(), target_client_id: targetClientId || null })
  if (targetClientId) {
    const set = wsClients.get(targetClientId)
    if (!set) return
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    }
    return
  }
  for (const set of wsClients.values()) {
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    }
  }
}

function safeParseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch (error) {
    return null
  }
}

function getClientIdFromRequest(req: express.Request): string {
  const fromHeader = String(req.headers['x-webtask-client-id'] || '').trim()
  const fromQuery = String(req.query.client_id || '').trim()
  const fromBody = String(req.body?.client_id || '').trim()
  return fromHeader || fromQuery || fromBody || `legacy:${req.ip || 'unknown'}`
}

function claimPendingWebtask(clientId: string) {
  const now = nowIso()
  const taskRecord = queryFirst(
    `SELECT * FROM webtasks
     WHERE
       (status = 'pending' OR (status = 'claimed' AND lease_until IS NOT NULL AND lease_until < ?))
       AND (not_before IS NULL OR not_before <= ?)
       AND (expires_at IS NULL OR expires_at > ?)
       AND (attempt_count IS NULL OR max_attempts IS NULL OR attempt_count < max_attempts)
       AND (target_client_id IS NULL OR target_client_id = '' OR target_client_id = ?)
     ORDER BY priority DESC, id ASC
     LIMIT 1`,
    [now, now, now, clientId]
  ) as any

  if (!taskRecord) {
    return null
  }

  const leaseUntil = addSeconds(now, WEBTASK_LEASE_SECONDS)
  run(
    `UPDATE webtasks
     SET status = 'claimed',
         claimed_by = ?,
         claimed_at = ?,
         lease_until = ?,
         attempt_count = COALESCE(attempt_count, 0) + 1,
         updated_at = ?
     WHERE id = ?`,
    [clientId, now, leaseUntil, now, taskRecord.id]
  )

  const claimed = queryFirst('SELECT * FROM webtasks WHERE id = ?', [taskRecord.id]) as any
  if (!claimed || claimed.claimed_by !== clientId || claimed.status !== 'claimed') {
    return null
  }

  let payload = safeParseJson(claimed.payload)
  if (!payload || typeof payload !== 'object') {
    payload = { task: null }
  }

  return {
    job_id: String(claimed.id),
    task: payload.task || claimed.task_name || null,
    data: payload.data || null,
    lease_until: leaseUntil,
    attempt: Number(claimed.attempt_count || 0),
    trace_id: claimed.trace_id || null,
    target_client_id: claimed.target_client_id || null
  }
}

app.use('/api/webtask/pending', requireWebtaskAuth)
app.use('/api/webtask/report', requireWebtaskAuth)
app.use('/api/webtask/heartbeat', requireWebtaskAuth)

// ---------------- 备份与恢复 API ----------------
app.get('/api/backup/download', (req, res) => {
  try {
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data')
    const dbPath = path.join(dataDir, 'monitor.db')
    import('fs').then(fs => {
        if (fs.existsSync(dbPath)) {
          saveNow() // 强制将内存数据落盘
          res.download(dbPath, `monitora_backup_${new Date().toISOString().split('T')[0]}.sqlite`)
        } else {
          res.status(404).json({ error: 'Database file not found' })
        }
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/backup/restore', (req, res) => {
  try {
    const base64Data = req.body?.data
    if (!base64Data) {
      return res.status(400).json({ error: 'Empty file data' })
    }
    
    const buffer = Buffer.from(base64Data, 'base64')
    
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data')
    const dbPath = path.join(dataDir, 'monitor.db')
    
    // 覆盖本地文件
    fs.writeFileSync(dbPath, buffer)
    console.log('Database restored from upload. Restarting...')
    
    res.json({ success: true, message: 'Database restored successfully, restarting server...' })
    
    // 重启服务端以重新加载数据库文件
    setTimeout(() => {
      process.exit(0)
    }, 1000)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/backup/settings', (req, res) => {
  try {
    const keys = [
      'backup_cron',
      'backup_tg_enabled',
      'backup_tg_chat_id',
      'backup_webdav_enabled',
      'backup_webdav_url',
      'backup_webdav_user',
      'backup_webdav_password'
    ]
    const settings: Record<string, string> = {}
    for (const key of keys) {
      const row = queryFirst('SELECT value FROM system_settings WHERE key = ?', [key]) as any
      settings[key] = row ? row.value : ''
    }
    res.json(settings)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/backup/settings', (req, res) => {
  try {
    const settings = req.body
    const allowedKeys = [
      'backup_cron',
      'backup_tg_enabled',
      'backup_tg_chat_id',
      'backup_webdav_enabled',
      'backup_webdav_url',
      'backup_webdav_user',
      'backup_webdav_password'
    ]
    
    for (const key of allowedKeys) {
      if (settings[key] !== undefined) {
        run("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))", [key, String(settings[key])])
      }
    }
    
    initBackupScheduler()
    
    res.json({ success: true, message: 'Backup settings saved.' })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/backup/trigger', async (req, res) => {
  try {
    const result = await performBackup()
    if (result.success) {
      res.json({ success: true, message: result.message })
    } else {
      res.status(400).json({ error: result.message })
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// ==================== SSE 刷新通知服务 ====================

// SSE 连接端点 - 浏览器插件连接此端点接收实时刷新通知
app.get('/api/sse/refresh', (req, res) => {
  const clientId = crypto.randomUUID()
  addClient(clientId, res)
})

// Webhook 接收端点 - 触发页面刷新
app.post('/api/webhook/refresh', (req, res) => {
  try {
    const { url } = req.body

    if (!url) {
      return res.status(400).json({ error: 'url is required' })
    }

    broadcastRefresh(url, 'refresh')
    res.json({
      success: true,
      message: `Refresh notification sent for ${url}`,
      clients: getClientCount()
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// 获取 SSE 客户端状态
app.get('/api/sse/status', (req, res) => {
  res.json({
    connected_clients: getClientCount(),
    clients: getClients()
  })
})

// 轮询模式端点 - 供浏览器插件轮询获取刷新通知
app.get('/poll', (req, res) => {
  const since = (req.query.since as string) || '0'
  const result = pollRefresh(since)
  res.json(result)
})

// ==================== Komari 直接通知服务 ====================

// 获取 Komari 通知配置
app.get('/api/settings/komari-notify', (req, res) => {
  try {
    const enabled = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'komari_notify_enabled'"
    ) as { value: string } | null
    const chatId = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'komari_notify_chat_id'"
    ) as { value: string } | null
    const webhookUrl = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'komari_notify_webhook_url'"
    ) as { value: string } | null
    const webhookBody = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'komari_notify_webhook_body'"
    ) as { value: string } | null

    res.json({
      enabled: enabled?.value === '1',
      chat_id: chatId?.value || '',
      webhook_url: webhookUrl?.value || '',
      webhook_body: webhookBody?.value || ''
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// 保存 Komari 通知配置
app.post('/api/settings/komari-notify', (req, res) => {
  try {
    const { enabled, chat_id, webhook_url, webhook_body } = req.body

    run(
      "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('komari_notify_enabled', ?, datetime('now'))",
      [enabled ? '1' : '0']
    )
    run(
      "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('komari_notify_chat_id', ?, datetime('now'))",
      [chat_id || '']
    )
    run(
      "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('komari_notify_webhook_url', ?, datetime('now'))",
      [webhook_url || '']
    )
    run(
      "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('komari_notify_webhook_body', ?, datetime('now'))",
      [webhook_body || '']
    )

    res.json({ success: true, message: '配置已保存' })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Komari 直接通知接收端点
app.post('/api/komari-notify', async (req, res) => {
  try {
    const { message, title } = req.body
    const text = message || title || ''

    const cleanTitle = stripHtml(title || '')
    const cleanMessage = stripHtml(message || '')

    console.log(
      `📩 收到 Komari 通知: ${cleanTitle || '(无标题)'} - ${cleanMessage?.substring(0, 50) || '(无内容)'}...`
    )

    // 检查是否启用
    const enabledResult = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'komari_notify_enabled'"
    ) as { value: string } | null
    if (enabledResult?.value !== '1') {
      return res.json({ success: true, message: 'Komari 通知已禁用，忽略' })
    }

    // 获取 TG 群组 ID（全局配置）
    const chatIdResult = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'komari_notify_chat_id'"
    ) as { value: string } | null
    const chatId = chatIdResult?.value || ''

    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

    // 判断是离线还是恢复（根据关键词）
    const textLower = text.toLowerCase()
    const isOffline =
      textLower.includes('离线') ||
      textLower.includes('offline') ||
      textLower.includes('down') ||
      textLower.includes('掉线')
    const isRecovery =
      textLower.includes('恢复') ||
      textLower.includes('上线') ||
      textLower.includes('online') ||
      textLower.includes('recovery') ||
      textLower.includes('up')

    // 查找所有 Komari Webhook 类型的监控项（被动接收通知）
    const monitors = queryAll(
      "SELECT * FROM monitors WHERE check_type = 'komari_webhook' AND is_active = 1"
    ) as Monitor[]

    // 从消息中匹配服务器名称
    let matchedMonitor: Monitor | null = null
    let matchedServerName = ''

    for (const monitor of monitors) {
      // 使用 expected_keyword 作为服务器名称匹配（与现有逻辑一致）
      const targetServers = monitor.expected_keyword
        ? monitor.expected_keyword
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(s => s)
        : []

      if (targetServers.length === 0) continue

      // 检查消息是否包含任何目标服务器名称
      for (const serverName of targetServers) {
        if (textLower.includes(serverName)) {
          matchedMonitor = monitor
          matchedServerName = serverName
          break
        }
      }
      if (matchedMonitor) break
    }

    if (isOffline) {
      // ===== 离线通知 =====
      console.log(
        `🔴 检测到离线通知${matchedMonitor ? ` (匹配监控: ${matchedMonitor.name}, 服务器: ${matchedServerName})` : ' (未匹配到监控)'}`
      )

      // 1. 发送 TG 离线消息（使用清理后的内容）
      if (chatId) {
        const offlineMsg = [
          `🔴 *Komari 离线通知*`,
          ``,
          `📋 *标题:* ${cleanTitle || '(无)'}`,
          `📝 *内容:* ${cleanMessage || '(无)'}`,
          matchedMonitor ? `🖥️ *匹配监控:* ${matchedMonitor.name}` : `⚠️ *未匹配到监控项*`,
          ``,
          `\`⏰ ${timeStr}\``
        ].join('\n')
        await sendTgMessage(
          chatId,
          offlineMsg,
          matchedMonitor
            ? {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: '🔄 重发 Webhook',
                        callback_data: `retry_webhook:${matchedMonitor.id}`
                      }
                    ]
                  ]
                }
              }
            : undefined
        )
      }

      // 1.5 如果匹配到监控项，保存检查记录（更新面板状态）
      if (matchedMonitor) {
        run(
          `INSERT INTO monitor_checks (monitor_id, status, response_time, status_code, error_message, checked_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [matchedMonitor.id, 'down', 0, 0, cleanMessage || '离线', new Date().toISOString()]
        )
        console.log(`📝 已记录监控 "${matchedMonitor.name}" 状态为 down`)
      }

      // 2. 如果匹配到监控项，使用其 Webhook 配置
      if (matchedMonitor && matchedMonitor.webhook_url) {
        let webhookSuccess = false
        let webhookError = ''

        try {
          // 构造 Webhook 请求
          const variables = {
            monitor_name: matchedMonitor.name,
            monitor_url: matchedMonitor.url,
            status: 'down',
            error: message || '',
            timestamp: timeStr,
            response_time: '0',
            status_code: '0'
          }

          let payload: any
          if (matchedMonitor.webhook_body) {
            // 使用监控项的自定义模板
            const body = JSON.parse(matchedMonitor.webhook_body)
            payload = processWebhookBody(body, variables)
          } else {
            // 默认格式
            payload = {
              monitor: matchedMonitor.name,
              url: matchedMonitor.url,
              status: 'down',
              timestamp: timeStr,
              message: `🚨 ${matchedMonitor.name} is DOWN! ${message?.substring(0, 100) || ''}`
            }
          }

          let headers: Record<string, string> = {
            'Content-Type': matchedMonitor.webhook_content_type || 'application/json'
          }

          if (matchedMonitor.webhook_headers) {
            headers = { ...headers, ...parseStoredHeaders(matchedMonitor.webhook_headers) }
          }

          if (matchedMonitor.webhook_username) {
            const encodedAuth = Buffer.from(`${matchedMonitor.webhook_username}:`).toString(
              'base64'
            )
            headers['Authorization'] = `Basic ${encodedAuth}`
          }

          console.log(`📤 发送 Webhook: ${matchedMonitor.webhook_url}`)

          // 添加 10 秒超时控制
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000)

          const webhookMethod = getWebhookMethod(matchedMonitor.webhook_method)
          const response = await fetch(matchedMonitor.webhook_url, {
            method: webhookMethod,
            headers,
            body: webhookMethod === 'GET' ? undefined : JSON.stringify(payload),
            signal: controller.signal
          })

          clearTimeout(timeoutId)

          webhookSuccess = response.ok
          if (!webhookSuccess) {
            webhookError = `HTTP ${response.status}`
          }
        } catch (err: any) {
          webhookError = err.message
          // 记录详细错误信息
          if (err.cause) {
            console.error('Webhook 详细错误:', err.cause)
          }
        }

        // 3. 发送 TG Webhook 执行结果
        if (chatId) {
          const resultEmoji = webhookSuccess ? '✅' : '❌'
          const resultText = webhookSuccess ? '成功' : `失败: ${webhookError}`
          const webhookResultMsg = [
            `📤 *Webhook 执行结果*`,
            ``,
            `🖥️ *监控项:* ${matchedMonitor.name}`,
            `${resultEmoji} *状态:* ${resultText}`,
            `🔗 *URL:* ${matchedMonitor.webhook_url.substring(0, 50)}...`,
            ``,
            `\`⏰ ${timeStr}\``
          ].join('\n')
          await sendTgMessage(chatId, webhookResultMsg)
        }

        console.log(
          `📤 Webhook 调用 (${matchedMonitor.name}): ${webhookSuccess ? '成功' : '失败 - ' + webhookError}`
        )
      } else if (matchedMonitor) {
        console.log(`⚠️ 监控项 ${matchedMonitor.name} 未配置 Webhook`)
      }

      res.json({
        success: true,
        type: 'offline',
        matched_monitor: matchedMonitor?.name || null,
        message: matchedMonitor
          ? `离线通知已处理 (${matchedMonitor.name})`
          : '离线通知已处理（未匹配到监控）'
      })
    } else if (isRecovery) {
      // ===== 恢复通知 =====
      console.log(
        `🟢 检测到恢复通知${matchedMonitor ? ` (匹配监控: ${matchedMonitor.name})` : ' (未匹配到监控)'}`
      )

      // 仅发送 TG 恢复消息，不调用 Webhook
      if (chatId) {
        const recoveryMsg = [
          `🟢 *Komari 恢复通知*`,
          ``,
          `📋 *标题:* ${cleanTitle || '(无)'}`,
          `📝 *内容:* ${cleanMessage || '(无)'}`,
          matchedMonitor ? `🖥️ *匹配监控:* ${matchedMonitor.name}` : ``,
          ``,
          `\`⏰ ${timeStr}\``
        ].join('\n')
        await sendTgMessage(chatId, recoveryMsg)
      }

      // 如果匹配到监控项，保存检查记录（更新面板状态为正常）
      if (matchedMonitor) {
        run(
          `INSERT INTO monitor_checks (monitor_id, status, response_time, status_code, error_message, checked_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [matchedMonitor.id, 'up', 0, 0, '', new Date().toISOString()]
        )
        console.log(`📝 已记录监控 "${matchedMonitor.name}" 状态为 up`)
      }

      res.json({
        success: true,
        type: 'recovery',
        matched_monitor: matchedMonitor?.name || null,
        message: '恢复通知已处理（未触发 Webhook）'
      })
    } else {
      // 未识别的通知类型
      console.log('⚠️ 未识别的通知类型，仅转发到 TG')

      if (chatId) {
        const unknownMsg = [
          `📨 *Komari 通知*`,
          ``,
          `📋 *标题:* ${cleanTitle || '(无)'}`,
          `📝 *内容:* ${cleanMessage || '(无)'}`,
          ``,
          `\`⏰ ${timeStr}\``
        ].join('\n')
        await sendTgMessage(chatId, unknownMsg)
      }

      res.json({ success: true, type: 'unknown', message: '未识别的通知类型，已转发到 TG' })
    }
  } catch (error: any) {
    console.error('❌ Komari 通知处理失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 接收 Komari TG 中转服务的 Webhook
app.post('/api/webhook/komari', async (req, res) => {
  try {
    const { source, status, server_name, raw_message, timestamp } = req.body

    console.log(`📩 收到 Komari TG 中转通知: ${server_name} -> ${status}`)

    // 查找匹配的 Komari 监控项
    const monitors = queryAll(
      "SELECT * FROM monitors WHERE check_type = 'komari' AND is_active = 1"
    ) as Monitor[]

    let matched = false

    for (const monitor of monitors) {
      // 检查是否匹配目标服务器
      const targetServers = monitor.expected_keyword
        ? monitor.expected_keyword
            .split(',')
            .map(s => s.trim())
            .filter(s => s)
        : null

      // 如果设置了目标服务器，检查是否匹配
      if (targetServers && targetServers.length > 0) {
        const isTarget = targetServers.some(
          target =>
            server_name.toLowerCase().includes(target.toLowerCase()) ||
            target.toLowerCase().includes(server_name.toLowerCase())
        )
        if (!isTarget) continue
      }

      matched = true
      const checkStatus = status === 'down' ? 'down' : 'up'

      // 保存检查记录
      run(
        `INSERT INTO monitor_checks (monitor_id, status, response_time, status_code, error_message, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          monitor.id,
          checkStatus,
          0,
          0,
          checkStatus === 'down' ? `TG 通知: ${server_name} 离线` : '',
          timestamp || new Date().toISOString()
        ]
      )

      // 如果是离线状态，创建事件
      if (checkStatus === 'down') {
        const existingIncident = queryFirst(
          'SELECT id FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL',
          [monitor.id]
        )

        if (!existingIncident) {
          run('INSERT INTO incidents (monitor_id, started_at, notified) VALUES (?, ?, 1)', [
            monitor.id,
            new Date().toISOString()
          ])
        }
      } else {
        // 上线则解决事件
        const incident = queryFirst(
          'SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL',
          [monitor.id]
        ) as any

        if (incident) {
          const resolvedAt = new Date().toISOString()
          const startedAt = new Date(incident.started_at)
          const durationSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000)

          run('UPDATE incidents SET resolved_at = ?, duration_seconds = ? WHERE id = ?', [
            resolvedAt,
            durationSeconds,
            incident.id
          ])
        }
      }

      console.log(`✅ 已更新监控 "${monitor.name}" 状态为 ${checkStatus}`)
    }

    if (matched) {
      res.json({ success: true, message: 'Status updated' })
    } else {
      res.json({ success: true, message: 'No matching monitor found' })
    }
  } catch (error: any) {
    console.error('Webhook error:', error)
    res.status(500).json({ error: error.message })
  }
})

// 获取 Komari 服务器状态
app.get('/api/komari-status/:id', async (req, res) => {
  try {
    const { id } = req.params
    const monitor = queryFirst('SELECT * FROM monitors WHERE id = ?', [id]) as Monitor

    if (!monitor) {
      return res.status(404).json({ error: 'Monitor not found' })
    }

    if (monitor.check_type !== 'komari') {
      return res.status(400).json({ error: 'Not a Komari monitor' })
    }

    const response = await fetch(monitor.url, {
      method: 'GET',
      headers: { 'User-Agent': 'UptimeMonitor/1.0' }
    })

    if (!response.ok) {
      return res.status(502).json({ error: `Komari API returned ${response.status}` })
    }

    const data = (await response.json()) as any

    if (data.status !== 'success') {
      return res.status(502).json({ error: data.message || 'Komari API error' })
    }

    const offlineThreshold = (monitor.komari_offline_threshold || 3) * 60 * 1000
    const now = Date.now()
    const targetServers = monitor.expected_keyword
      ? monitor.expected_keyword
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => s)
      : null

    const servers = data.data
      .map((server: any) => {
        if (targetServers && targetServers.length > 0) {
          const isTarget = targetServers.some((target: string) => server.name === target)
          if (!isTarget) return null
        }

        const updatedAt = new Date(server.updated_at).getTime()
        const timeSinceUpdate = now - updatedAt
        const isOnline = timeSinceUpdate <= offlineThreshold

        return {
          name: server.name,
          region: server.region,
          updated_at: server.updated_at,
          minutes_ago: Math.floor(timeSinceUpdate / 60000),
          is_online: isOnline
        }
      })
      .filter(Boolean)

    res.json({ servers })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// ==========================================
// 哪吒 (Nezha) Webhook 集成
// ==========================================

// 获取 Nezha 通知配置
app.get('/api/settings/nezha-notify', (req, res) => {
  try {
    const enabled = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'nezha_notify_enabled'"
    ) as { value: string } | null
    const chatId = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'nezha_notify_chat_id'"
    ) as { value: string } | null

    res.json({
      enabled: enabled?.value === '1',
      chat_id: chatId?.value || ''
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// 保存 Nezha 通知配置
app.post('/api/settings/nezha-notify', (req, res) => {
  try {
    const { enabled, chat_id } = req.body

    run(
      "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('nezha_notify_enabled', ?, datetime('now'))",
      [enabled ? '1' : '0']
    )
    run(
      "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('nezha_notify_chat_id', ?, datetime('now'))",
      [chat_id || '']
    )

    res.json({ success: true, message: '配置已保存' })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Nezha 通知接收端点 (接收 JSON)
app.post('/api/nezha-notify-v1', async (req, res) => {
  try {
    // Nezha Payload Example:
    // {
    //   "project": "NezhaMonitor",
    //   "server_name": "evennode",
    //   "server_ip": "37.187.248.7",
    //   "message": "[事件] evennode(37.****.7) 离线"
    // }
    const { server_name, message } = req.body
    const serverName = server_name || ''
    const text = message || ''

    console.log(`📩 收到 Nezha 通知: ${serverName} - ${text}`)

    // 1. 检查是否启用全局接收
    const enabledResult = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'nezha_notify_enabled'"
    ) as { value: string } | null
    if (enabledResult?.value !== '1') {
      return res.json({ success: true, message: 'Nezha 通知接收已禁用' })
    }

    // 2. 解析状态 (优先判断恢复，防止哪吒"缝合怪"消息误判)
    // 哪吒恢复消息格式: "[恢复] server(ip) offline" —— 同时包含"恢复"和"offline"
    // 必须优先检查恢复关键词，命中后不再检查离线关键词
    const textLower = text.toLowerCase()
    let isOffline = false
    let isRecovery = false

    const hasRecoveryTag = textLower.includes('[恢复]') || textLower.includes('【恢复】')
    const hasEventTag = textLower.includes('[事件]') || textLower.includes('【事件】')

    if (
      hasRecoveryTag ||
      textLower.includes('恢复') ||
      textLower.includes('上线') ||
      textLower.includes('recovery') ||
      textLower.includes('online')
    ) {
      isRecovery = true
    } else if (
      hasEventTag ||
      textLower.includes('离线') ||
      textLower.includes('offline') ||
      textLower.includes('down')
    ) {
      isOffline = true
    }

    if (!isOffline && !isRecovery) {
      return res.json({ success: true, message: '未识别的状态变化，忽略' })
    }

    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const chatIdResult = queryFirst(
      "SELECT value FROM system_settings WHERE key = 'nezha_notify_chat_id'"
    ) as { value: string } | null
    const chatId = chatIdResult?.value || ''

    // 3. 离线：匹配监控项、更新状态、发带按钮通知
    if (isOffline) {
      const monitors = queryAll(
        "SELECT * FROM monitors WHERE check_type = 'nezha_webhook' AND is_active = 1"
      ) as Monitor[]

      let matchedMonitor: Monitor | null = null
      const serverNameLower = serverName.toLowerCase().trim()
      for (const monitor of monitors) {
        const targetServers = monitor.expected_keyword
          ? monitor.expected_keyword
              .split(',')
              .map(s => s.trim().toLowerCase())
              .filter(s => s)
          : []

        if (targetServers.length === 0) continue

        const isTarget = targetServers.some(
          target => serverNameLower.includes(target) || target.includes(serverNameLower)
        )

        if (isTarget) {
          matchedMonitor = monitor
          break
        }
      }

      if (matchedMonitor) {
        const checkData: MonitorCheck = {
          monitor_id: matchedMonitor.id,
          status: 'down',
          response_time: 0,
          status_code: 0,
          error_message: `Nezha Alert: ${text}`,
          checked_at: new Date().toISOString()
        }
        saveCheck(checkData)
        await handleDownStatus(matchedMonitor, checkData)

        // 发带"匹配监控"和"重发 Webhook"按钮的通知
        if (chatId) {
          const msg = [
            `🔴 *Nezha 离线通知*`,
            ``,
            `📋 *标题:* Offline`,
            `📝 *内容:* 🖥️ 服务器状态监控`,
            ``,
            `🖥️ *主机名称:* ${serverName}`,
            `🔄 *运行状态:* Offline 🔴`,
            `📨 *消息回执:* ✅`,
            `🔍 *匹配监控:* ${matchedMonitor.name}`,
            ``,
            `\`⏰ ${timeStr}\``
          ].join('\n')
          await sendTgMessage(chatId, msg, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 重发 Webhook', callback_data: `retry_webhook:${matchedMonitor.id}` }]
              ]
            }
          })
        }

        // 发送 Webhook 并回报执行结果到 TG（Nezha）
        if (matchedMonitor.webhook_url) {
          let webhookSuccess = false
          let webhookError = ''

          try {
            const result = await sendWebhookNotification(matchedMonitor, checkData, 'down')
            webhookSuccess = result.success
            if (!webhookSuccess) {
              webhookError = result.error || 'Unknown error'
            }
          } catch (err: any) {
            webhookError = err.message || 'Unknown error'
          }

          if (chatId) {
            const resultEmoji = webhookSuccess ? '✅' : '❌'
            const resultText = webhookSuccess ? '成功' : `失败: ${webhookError}`
            const webhookResultMsg = [
              `📤 *Webhook 执行结果*`,
              ``,
              `🖥️ *监控项:* ${matchedMonitor.name}`,
              `${resultEmoji} *状态:* ${resultText}`,
              `🔗 *URL:* ${matchedMonitor.webhook_url.substring(0, 50)}...`,
              ``,
              `\`⏰ ${timeStr}\``
            ].join('\n')
            await sendTgMessage(chatId, webhookResultMsg)
          }
        }
      } else {
        // 匹配不到，发简单通知
        if (chatId) {
          const msg = [
            `🔴 *Nezha 离线通知*`,
            ``,
            `📋 *标题:* Offline`,
            `📝 *内容:* 🖥️ 服务器状态监控`,
            ``,
            `🖥️ *主机名称:* ${serverName}`,
            `🔄 *运行状态:* Offline 🔴`,
            `📨 *消息回执:* ✅`,
            ``,
            `\`⏰ ${timeStr}\``
          ].join('\n')
          await sendTgMessage(chatId, msg)
        }
      }
    }

    // 4. 恢复：只发简单通知，不匹配，不触发 Webhook
    if (isRecovery) {
      // 更新监控项状态（如果有匹配的）
      const monitors = queryAll(
        "SELECT * FROM monitors WHERE check_type = 'nezha_webhook' AND is_active = 1"
      ) as Monitor[]
      const serverNameLower = serverName.toLowerCase().trim()
      for (const monitor of monitors) {
        const targetServers = monitor.expected_keyword
          ? monitor.expected_keyword
              .split(',')
              .map(s => s.trim().toLowerCase())
              .filter(s => s)
          : []

        if (targetServers.length === 0) continue

        const isTarget = targetServers.some(
          target => serverNameLower.includes(target) || target.includes(serverNameLower)
        )

        if (isTarget) {
          const checkData: MonitorCheck = {
            monitor_id: monitor.id,
            status: 'up',
            response_time: 0,
            status_code: 200,
            error_message: '',
            checked_at: new Date().toISOString()
          }
          saveCheck(checkData)
          await handleUpStatus(monitor, checkData)
          break
        }
      }

      // 发简单恢复通知，不带按钮
      if (chatId) {
        const msg = [
          `🟢 *Nezha 恢复通知*`,
          ``,
          `📋 *标题:* Recovery`,
          `📝 *内容:* 🖥️ 服务器状态监控`,
          ``,
          `🖥️ *主机名称:* ${serverName}`,
          `🔄 *运行状态:* Online 🟢`,
          `📨 *消息回执:* ✅`,
          ``,
          `\`⏰ ${timeStr}\``
        ].join('\n')
        await sendTgMessage(chatId, msg)
      }
    }

    res.json({ success: true })
  } catch (error: any) {
    console.error('Nezha Webhook Error:', error)
    res.status(500).json({ error: error.message })
  }
})

// ==========================================
// 反馈联动模式 (Feedback Linkage Mode) 回调
// ==========================================
// 灵活用法：通用回调入口，通过 server_name 匹配监控项
app.post('/api/callback', async (req, res) => {
  try {
    const { server_name, remaining_time, status, message } = req.body
    if (!server_name) {
      return res.status(400).json({ error: '必须提供 server_name 以匹配监控项' })
    }

    // 搜索匹配关键词的反馈联动监控项
    const monitor = queryFirst(
      "SELECT * FROM monitors WHERE check_type = 'feedback_linkage' AND (expected_keyword LIKE ? OR name = ?)",
      [`%${server_name}%`, server_name]
    ) as Monitor

    if (!monitor) {
      return res.status(404).json({ error: `未匹配到名称包含 "${server_name}" 的联动监控项` })
    }

    return handleFeedbackCallback(monitor, remaining_time, status, message, res)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/callback/:monitorId', async (req, res) => {
  try {
    const { monitorId } = req.params
    const { remaining_time, status, message } = req.body

    const monitor = queryFirst('SELECT * FROM monitors WHERE id = ?', [monitorId]) as Monitor
    if (!monitor) {
      return res.status(404).json({ error: '监控项不存在' })
    }

    return handleFeedbackCallback(monitor, remaining_time, status, message, res)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

async function handleFeedbackCallback(
  monitor: Monitor,
  remaining_time: number,
  status: string,
  message: string,
  res: any
) {
  try {
    console.log(
      `📡 收到反馈联动回调: [${monitor.name}] 剩余时间: ${remaining_time}s, 状态: ${status || '无'}`
    )

    // 1. 计算随机触发点 (Actual Trigger Point = Threshold - random(Min, Max))
    const now = Date.now()
    let nextCheckAt: string

    const baseThresholdMins = monitor.feedback_threshold || 1440
    const fluMin = monitor.feedback_fluctuation_min || 0
    const fluMax = monitor.feedback_fluctuation_max || 0

    // 随机产生一个波动值 (分钟)
    const randomOffset =
      fluMax !== null && fluMax > fluMin ? Math.random() * (fluMax - fluMin) + fluMin : fluMin

    // 实际触发点 (分钟)
    const triggerPointMins = baseThresholdMins - randomOffset
    const triggerPointSeconds = triggerPointMins * 60

    if (remaining_time !== undefined && remaining_time > triggerPointSeconds) {
      // 剩余时间还在触发点之上，计算需要等待多久到达触发点
      const waitSeconds = remaining_time - triggerPointSeconds
      nextCheckAt = new Date(now + waitSeconds * 1000).toISOString()
      console.log(
        `⏳ [${monitor.name}] 尚未到达触发点 (${triggerPointMins.toFixed(2)}m)，预计在 ${(waitSeconds / 60).toFixed(2)}m 后再次检查`
      )
    } else {
      // 已到达或低于触发点，立即触发检测逻辑 (或按默认小间隔重试以免错过)
      const checkInterval = monitor.check_interval || 5
      const checkIntervalMax = monitor.check_interval_max
      let nextInterval = checkInterval
      if (checkIntervalMax && checkIntervalMax > checkInterval) {
        nextInterval =
          Math.floor(Math.random() * (checkIntervalMax - checkInterval + 1)) + checkInterval
      }
      nextCheckAt = new Date(now + nextInterval * 60 * 1000).toISOString()
      console.log(
        `🔥 [${monitor.name}] 已到达触发点 (${triggerPointMins.toFixed(2)}m)，准备执行任务`
      )
    }

    // 2. 更新监控项状态和下次检查时间
    run('UPDATE monitors SET next_check_at = ?, updated_at = ? WHERE id = ?', [
      nextCheckAt,
      new Date().toISOString(),
      monitor.id
    ])

    // 3. 记录一次 Check
    const isSuccess = status
      ? status === 'success' || status === 'up'
      : remaining_time !== undefined && remaining_time > 0
    const checkData: MonitorCheck = {
      monitor_id: monitor.id,
      status: isSuccess ? 'up' : 'down',
      response_time: 0,
      status_code: isSuccess ? 200 : 500,
      error_message:
        message ||
        (isSuccess
          ? remaining_time !== undefined
            ? `收到反馈: 剩余 ${remaining_time}s`
            : '收到反馈回调'
          : '联动检测不通过'),
      checked_at: new Date().toISOString()
    }

    saveCheck(checkData)

    if (!isSuccess) {
      await handleDownStatus(monitor, checkData)
    } else {
      await handleUpStatus(monitor, checkData)
    }

    // 4. 发送 TG 通知（带重试按钮）
    if (monitor.tg_notify_chat_id) {
      const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      const icon = isSuccess ? '✅' : '❌'
      const statusText = isSuccess ? '成功' : '失败'
      const remainHours = remaining_time !== undefined ? (remaining_time / 3600).toFixed(2) : '未知'

      const msg = [
        `${icon} *反馈联动回调: ${statusText}*`,
        ``,
        `📋 *任务:* ${monitor.name}`,
        `⏱ *剩余时间:* ${remainHours}h`,
        `🎯 *触发点:* ${triggerPointHours.toFixed(2)}h`,
        remaining_time !== undefined && remaining_time > triggerPointSeconds
          ? `⏳ *状态:* 未到触发点，等待中`
          : `🔥 *状态:* 已到触发点，准备执行`,
        message ? `💬 *备注:* ${message}` : '',
        ``,
        `\`⏰ ${timeStr}\``
      ]
        .filter(Boolean)
        .join('\n')

      try {
        await sendTgMessage(monitor.tg_notify_chat_id, msg, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 立即重试', callback_data: `retry_scheduled:${monitor.id}` }]
            ]
          }
        })
      } catch (tgErr) {
        console.error('发送反馈联动 TG 通知失败:', tgErr)
      }
    }

    return res.json({
      success: true,
      matched_monitor: monitor.name,
      trigger_point_hours: Number(triggerPointHours.toFixed(2)),
      next_check_at: nextCheckAt
    })
  } catch (error: any) {
    console.error('Error processing feedback callback:', error)
    return res.status(500).json({ error: error.message })
  }
}

// ==========================================
// WebTask 插件工作流中转服务
// ==========================================

// 1. 接收面板自己发出的 Webhook 任务并持久化入队
app.post('/api/webtask/queue', (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const payload = JSON.stringify(body)
    const taskName = typeof body.task === 'string' ? body.task.trim() : ''
    const dataJson = body.data !== undefined ? JSON.stringify(body.data) : null
    const priority = Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0
    const targetClientId =
      typeof body.target_client_id === 'string' && body.target_client_id.trim()
        ? body.target_client_id.trim()
        : null
    const maxAttempts =
      Number.isFinite(Number(body.max_attempts)) && Number(body.max_attempts) > 0
        ? Number(body.max_attempts)
        : WEBTASK_MAX_ATTEMPTS_DEFAULT
    const dedupeKey =
      typeof body.dedupe_key === 'string' && body.dedupe_key.trim() ? body.dedupe_key.trim() : null
    const notBefore =
      typeof body.not_before === 'string' && body.not_before.trim() ? body.not_before.trim() : null
    const expiresAt =
      typeof body.expires_at === 'string' && body.expires_at.trim() ? body.expires_at.trim() : null
    const now = nowIso()

    if (dedupeKey) {
      const exists = queryFirst(
        "SELECT id FROM webtasks WHERE dedupe_key = ? AND status IN ('pending', 'claimed') ORDER BY id DESC LIMIT 1",
        [dedupeKey]
      ) as { id: number } | null
      if (exists) {
        return res.json({ success: true, message: 'Duplicate task ignored', job_id: String(exists.id) })
      }
    }

    run(
      `INSERT INTO webtasks (
        payload, task_name, data_json, status, priority, target_client_id,
        attempt_count, max_attempts, dedupe_key, not_before, expires_at,
        trace_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload,
        taskName || null,
        dataJson,
        priority,
        targetClientId,
        maxAttempts,
        dedupeKey,
        notBefore,
        expiresAt,
        crypto.randomUUID(),
        now,
        now
      ]
    )

    const inserted = queryFirst('SELECT id FROM webtasks ORDER BY id DESC LIMIT 1') as { id: number }
    notifyTaskAvailable(targetClientId)
    res.json({ success: true, message: 'WebTask has been queued', job_id: String(inserted.id) })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// 2. 插件轮询拉取待处理任务
app.get('/api/webtask/pending', (req, res) => {
  try {
    const clientId = getClientIdFromRequest(req)
    upsertWebtaskClient(clientId, true)

    const payload = claimPendingWebtask(clientId)
    if (!payload || !payload.task) {
      return res.json({ task: null })
    }

    res.json(payload)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/webtask/heartbeat', (req, res) => {
  try {
    const clientId = getClientIdFromRequest(req)
    const jobId = String(req.body?.job_id || '').trim()
    const extendSeconds =
      Number.isFinite(Number(req.body?.extend_seconds)) && Number(req.body?.extend_seconds) > 0
        ? Math.min(Number(req.body.extend_seconds), 600)
        : WEBTASK_LEASE_SECONDS

    if (!jobId) {
      return res.status(400).json({ error: 'job_id is required' })
    }

    const row = queryFirst('SELECT * FROM webtasks WHERE id = ?', [jobId]) as any
    if (!row) {
      return res.status(404).json({ error: 'job not found' })
    }
    if (row.claimed_by !== clientId) {
      return res.status(409).json({ error: 'job is not owned by this client' })
    }

    const leaseUntil = addSeconds(nowIso(), extendSeconds)
    run('UPDATE webtasks SET lease_until = ?, updated_at = ? WHERE id = ?', [leaseUntil, nowIso(), jobId])
    upsertWebtaskClient(clientId, true)
    return res.json({ success: true, lease_until: leaseUntil })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// 3. 插件上报执行结果
app.post('/api/webtask/report', async (req, res) => {
  try {
    const { task, success, message, variables } = req.body
    const clientId = getClientIdFromRequest(req)
    const retryable = req.body?.retryable === true
    const jobId = String(req.body?.job_id || '').trim()
    const now = nowIso()

    let resolvedTask = task

    if (jobId) {
      const taskRecord = queryFirst('SELECT * FROM webtasks WHERE id = ?', [jobId]) as any
      if (!taskRecord) {
        return res.status(404).json({ error: 'job not found' })
      }
      if (taskRecord.claimed_by && taskRecord.claimed_by !== clientId) {
        return res.status(409).json({ error: 'job is not owned by this client' })
      }

      if (taskRecord.status === 'success' || taskRecord.status === 'failed' || taskRecord.status === 'dead') {
        return res.json({ success: true, message: 'already reported' })
      }

      const canRetry =
        !success &&
        retryable &&
        Number(taskRecord.attempt_count || 0) < Number(taskRecord.max_attempts || WEBTASK_MAX_ATTEMPTS_DEFAULT)

      if (canRetry) {
        const nextDelaySeconds = Math.min(
          WEBTASK_BACKOFF_BASE_SECONDS * Math.pow(2, Math.max(0, Number(taskRecord.attempt_count || 1) - 1)),
          900
        )
        const nextCheckAt = addSeconds(now, nextDelaySeconds)
        const status =
          Number(taskRecord.attempt_count || 0) >= Number(taskRecord.max_attempts || WEBTASK_MAX_ATTEMPTS_DEFAULT)
            ? 'dead'
            : 'pending'
        run(
          `UPDATE webtasks
           SET status = ?,
               claimed_by = NULL,
               claimed_at = NULL,
               lease_until = NULL,
               not_before = ?,
               last_error = ?,
               updated_at = ?
           WHERE id = ?`,
          [status, nextCheckAt, message || 'task failed', now, jobId]
        )
        if (status === 'pending') {
          notifyTaskAvailable(taskRecord.target_client_id || null)
        }
      } else {
        run(
          `UPDATE webtasks
           SET status = ?,
               report_success = ?,
               result_message = ?,
               result_variables = ?,
               last_error = ?,
               finished_at = ?,
               updated_at = ?
           WHERE id = ?`,
          [
            success ? 'success' : 'failed',
            success ? 1 : 0,
            message || '',
            variables && typeof variables === 'object' ? JSON.stringify(variables) : null,
            success ? null : message || 'task failed',
            now,
            now,
            jobId
          ]
        )
      }

      resolvedTask = taskRecord.task_name || task
    } else {
      // 兼容旧版插件（未携带 job_id）
      const legacyTask = queryFirst(
        `SELECT * FROM webtasks
         WHERE task_name = ? AND status = 'claimed' AND (claimed_by = ? OR claimed_by LIKE 'legacy:%')
         ORDER BY claimed_at DESC
         LIMIT 1`,
        [task, clientId]
      ) as any
      if (legacyTask) {
        run(
          `UPDATE webtasks
           SET status = ?,
               report_success = ?,
               result_message = ?,
               result_variables = ?,
               last_error = ?,
               finished_at = ?,
               updated_at = ?
           WHERE id = ?`,
          [
            success ? 'success' : 'failed',
            success ? 1 : 0,
            message || '',
            variables && typeof variables === 'object' ? JSON.stringify(variables) : null,
            success ? null : message || 'task failed',
            now,
            now,
            legacyTask.id
          ]
        )
      }
    }

    upsertWebtaskClient(clientId, true)

    // 优先从 variables 里取插件指定的 tg_notify_chat_id，如果没有，再找 Komari 全局通知群组 ID
    let chatId = variables?.tg_notify_chat_id
    if (!chatId) {
      const chatIdResult = queryFirst(
        "SELECT value FROM system_settings WHERE key = 'komari_notify_chat_id'"
      ) as { value: string } | null
      chatId = chatIdResult?.value
    }

    if (chatId) {
      const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      const statusIcon = success ? '✅' : '❌'
      const statusText = success ? '执行成功' : '执行失败'

      let varsInfo: string[] = []
      if (variables && typeof variables === 'object') {
        for (const [key, value] of Object.entries(variables)) {
          // 不在 TG 消息体里显示这个内部路由用的 ID
          if (key === 'tg_notify_chat_id') continue
          varsInfo.push(`🔹 *${key}:* ${value}`)
        }
      }

      const tgMsg = [
        `🤖 *WebTask 插件执行报告*`,
        ``,
        `⚙️ *任务命令:* \`${resolvedTask || '未知任务'}\``,
        `📊 *执行状态:* ${statusIcon} ${statusText}`,
        `💬 *结果信息:* ${message || '无'}`,
        ...varsInfo,
        ``,
        `\`⏰ ${timeStr}\``
      ]
        .filter(Boolean)
        .join('\n')

      await sendTgMessage(chatId, tgMsg)
    }

    res.json({ success: true, message: 'Report received and pushed to TG' })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// 手动触发检查
app.get('/trigger', async (req, res) => {
  await checkAllMonitors()
  res.json({ message: 'Monitor check triggered' })
})

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'))
})

// 初始化并启动服务
async function start() {
  await initDatabase()

  // 检查是否需要重置密码（通过环境变量）
  const resetPassword = process.env.RESET_PASSWORD
  if (resetPassword) {
    const newHash = await hashPassword(resetPassword)
    run('UPDATE admin_credentials SET password_hash = ?, updated_at = ? WHERE id = 1', [
      newHash,
      new Date().toISOString()
    ])
    console.log('🔐 密码已通过环境变量 RESET_PASSWORD 重置')
    console.log('⚠️  请移除 RESET_PASSWORD 环境变量后重启容器以确保安全')
  }

  // 初始化 Telegram Bot（如果配置了 Token）
  initTelegramBot()

  // Email IMAP 监听改为按需启动（请求验证码时启动）

  // 启动定时任务 - 每分钟检查一次，根据各监控的间隔决定是否执行
  cron.schedule('* * * * *', () => {
    console.log('Running scheduled monitor check...')
    checkAllMonitors()
  })

  const httpServer = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log('Monitor check scheduled every minute (respects individual intervals)')

    // 启动时执行一次检查
    checkAllMonitors()
    
    // 初始化自动备份任务
    initBackupScheduler()
  })

  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      if (reqUrl.pathname !== '/api/webtask/ws') {
        socket.destroy()
        return
      }

      const query: Record<string, unknown> = {}
      reqUrl.searchParams.forEach((value, key) => {
        query[key] = value
      })

      const auth = authenticateWebtaskRequest(req.headers as Record<string, unknown>, query)
      if (!auth.ok) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      const clientId = String(query.client_id || '').trim()
      if (!clientId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        ;(ws as WebSocket & { clientId?: string }).clientId = clientId
        wss.emit('connection', ws, req)
      })
    } catch (error) {
      socket.destroy()
    }
  })

  wss.on('connection', (ws: WebSocket & { clientId?: string }, req: IncomingMessage) => {
    const clientId = ws.clientId || ''
    if (!clientId) {
      ws.close(1008, 'client_id missing')
      return
    }

    let set = wsClients.get(clientId)
    if (!set) {
      set = new Set<WebSocket>()
      wsClients.set(clientId, set)
    }
    set.add(ws)
    upsertWebtaskClient(clientId, true, req)

    ws.send(JSON.stringify({ type: 'hello', client_id: clientId, ts: Date.now() }))

    ws.on('message', (raw: RawData) => {
      let data: any = null
      try {
        data = JSON.parse(raw.toString())
      } catch (error) {
        return
      }
      if (data?.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
      }
      upsertWebtaskClient(clientId, true, req)
    })

    ws.on('close', () => {
      const current = wsClients.get(clientId)
      if (current) {
        current.delete(ws)
        if (current.size === 0) {
          wsClients.delete(clientId)
          upsertWebtaskClient(clientId, false)
        }
      }
    })

    ws.on('error', () => {
      const current = wsClients.get(clientId)
      if (current) {
        current.delete(ws)
        if (current.size === 0) {
          wsClients.delete(clientId)
          upsertWebtaskClient(clientId, false)
        }
      }
    })
  })

  // 优雅关闭
  process.on('SIGTERM', () => {
    stopTelegramBot()
    process.exit(0)
  })

  // 定时任务：每天凌晨 3 点自动清理超过 3 天的历史监控记录，控制数据库体积
  cron.schedule('0 3 * * *', () => {
    cleanOldData(3)
  })
  
  // 启动时顺便执行一次清理
  cleanOldData(3)
}

start().catch(console.error)

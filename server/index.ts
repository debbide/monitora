import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { initDatabase, queryAll, queryFirst, run } from './db.js'
import { Monitor, MonitorCheck } from './types.js'
import { checkAllMonitors, checkMonitor, hashPassword, verifyPassword, saveCheck, handleDownStatus, handleUpStatus } from './monitor.js'
import { processWebhookBody } from './webhook-sender.js'
import { initTelegramBot, getTelegramBotStatus, stopTelegramBot, setTgBotToken, getTgBotToken, testChatConnection, sendTgMessage } from './telegram.js'
import { addClient, broadcastRefresh, getClientCount, getClients, pollRefresh } from './sse.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

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

    if ((body.check_type === 'http' || body.check_type === 'scheduled_webhook') && checkIntervalMax && checkIntervalMax > checkInterval) {
      nextInterval = Math.floor(Math.random() * (checkIntervalMax - checkInterval + 1)) + checkInterval
    }
    const initialNextCheck = new Date(now + (nextInterval * 60 * 1000)).toISOString()

    run(
      `INSERT INTO monitors (id, name, url, check_interval, check_interval_max, check_type, check_method, check_timeout, expected_status_codes, expected_keyword, forbidden_keyword, komari_offline_threshold, tg_chat_id, tg_server_name, tg_offline_keywords, tg_online_keywords, tg_notify_chat_id, webhook_url, webhook_content_type, webhook_headers, webhook_body, webhook_username, check_content_type, check_headers, check_body, next_check_at, is_active, feedback_linkage, feedback_threshold, feedback_threshold_max)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id,
        body.name,
        body.url || '',
        checkInterval,
        checkIntervalMax,
        body.check_type || 'http',
        body.check_method || 'GET',
        parseInt(body.check_timeout) || 30,
        body.expected_status_codes || '200,201,204,301,302',
        body.expected_keyword || null,
        body.forbidden_keyword || null,
        parseInt(body.komari_offline_threshold) || 3,
        body.check_content_type || 'application/json',
        body.check_headers && typeof body.check_headers === 'object' ? JSON.stringify(body.check_headers) : (body.check_headers || null),
        body.check_body && typeof body.check_body === 'object' ? JSON.stringify(body.check_body) : (body.check_body || null),
        body.tg_chat_id || null,
        body.tg_server_name || null,
        body.tg_offline_keywords || null,
        body.tg_online_keywords || null,
        body.tg_notify_chat_id || null,
        body.webhook_url || null,
        body.webhook_content_type || 'application/json',
        body.webhook_headers && typeof body.webhook_headers === 'object' ? JSON.stringify(body.webhook_headers) : (body.webhook_headers || null),
        body.webhook_body && typeof body.webhook_body === 'object' ? JSON.stringify(body.webhook_body) : (body.webhook_body || null),
        body.webhook_username || null,
        body.check_content_type || 'application/json',
        body.check_headers && typeof body.check_headers === 'object' ? JSON.stringify(body.check_headers) : (body.check_headers || null),
        body.check_body && typeof body.check_body === 'object' ? JSON.stringify(body.check_body) : (body.check_body || null),
        initialNextCheck,
        body.feedback_linkage || body.check_type === 'feedback_linkage' ? 1 : 0,
        parseInt(body.feedback_threshold) || 0,
        parseInt(body.feedback_threshold_max) || null
      ]
    )

    const monitor = queryFirst('SELECT * FROM monitors WHERE id = ?', [id]) as Monitor

    // 不再立即执行 checkMonitor(monitor)，而是等待 next_check_at
    if (monitor) {
      if (monitor.check_type === 'telegram' || monitor.check_type === 'komari_webhook') {
        // ... (保持不变) ...
        run(
          `INSERT INTO monitor_checks (monitor_id, status, response_time, status_code, error_message, checked_at)
           VALUES (?, 'up', 0, 0, NULL, datetime('now'))`,
          [id]
        )
      }
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

    if ((body.check_type === 'http' || body.check_type === 'scheduled_webhook') && checkIntervalMax && checkIntervalMax > checkInterval) {
      nextInterval = Math.floor(Math.random() * (checkIntervalMax - checkInterval + 1)) + checkInterval
    }
    const resetNextCheck = new Date(now + (nextInterval * 60 * 1000)).toISOString()

    run(
      `UPDATE monitors SET
        name = ?,
        url = ?,
        check_interval = ?,
        check_interval_max = ?,
        check_type = ?,
        check_method = ?,
        check_timeout = ?,
        expected_status_codes = ?,
        expected_keyword = ?,
        forbidden_keyword = ?,
        komari_offline_threshold = ?,
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
        webhook_headers = ?,
        webhook_body = ?,
        webhook_username = ?,
        check_content_type = ?,
        check_headers = ?,
        check_body = ?,
        is_active = ?,
        updated_at = ?,
        next_check_at = ?,
        feedback_linkage = ?,
        feedback_threshold = ?,
        feedback_threshold_max = ?
      WHERE id = ?`,
      [
        body.name,
        body.url || '',
        checkInterval,
        checkIntervalMax,
        body.check_type || 'http',
        body.check_method || 'GET',
        parseInt(body.check_timeout) || 30,
        body.expected_status_codes || '200,201,204,301,302',
        body.expected_keyword || null,
        body.forbidden_keyword || null,
        parseInt(body.komari_offline_threshold) || 3,
        body.check_content_type || 'application/json',
        body.check_headers && typeof body.check_headers === 'object' ? JSON.stringify(body.check_headers) : (body.check_headers || null),
        body.check_body && typeof body.check_body === 'object' ? JSON.stringify(body.check_body) : (body.check_body || null),
        body.tg_chat_id || null,
        body.tg_server_name || null,
        body.tg_offline_keywords || null,
        body.tg_online_keywords || null,
        body.tg_notify_chat_id || null,
        body.webhook_url || null,
        body.webhook_content_type || 'application/json',
        body.webhook_headers && typeof body.webhook_headers === 'object' ? JSON.stringify(body.webhook_headers) : (body.webhook_headers || null),
        body.webhook_body && typeof body.webhook_body === 'object' ? JSON.stringify(body.webhook_body) : (body.webhook_body || null),
        body.webhook_username || null,
        body.check_content_type || 'application/json',
        body.check_headers && typeof body.check_headers === 'object' ? JSON.stringify(body.check_headers) : (body.check_headers || null),
        body.check_body && typeof body.check_body === 'object' ? JSON.stringify(body.check_body) : (body.check_body || null),
        body.is_active !== undefined ? body.is_active : 1,
        new Date().toISOString(),
        resetNextCheck,
        body.feedback_linkage || body.check_type === 'feedback_linkage' ? 1 : 0,
        parseInt(body.feedback_threshold) || 0,
        parseInt(body.feedback_threshold_max) || null,
        id
      ]
    )

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

    const total = queryFirst(
      'SELECT COUNT(*) as count FROM monitor_checks WHERE monitor_id = ?',
      [monitorId]
    ) as any

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
      const customHeaders = JSON.parse(monitor.webhook_headers)
      headers = { ...headers, ...customHeaders }
    }

    if (monitor.webhook_username) {
      const encodedAuth = Buffer.from(`${monitor.webhook_username}:`).toString('base64')
      headers['Authorization'] = `Basic ${encodedAuth}`
    }

    await fetch(monitor.webhook_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
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
        const chatIdResult = queryFirst("SELECT value FROM system_settings WHERE key = 'komari_notify_chat_id'") as { value: string } | null
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
      res.json({ valid: true })
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

    run(
      'UPDATE admin_credentials SET password_hash = ?, updated_at = ? WHERE id = 1',
      [newHash, new Date().toISOString()]
    )

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
    res.json({ success: true, message: `Refresh notification sent for ${url}`, clients: getClientCount() })
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
    const enabled = queryFirst("SELECT value FROM system_settings WHERE key = 'komari_notify_enabled'") as { value: string } | null
    const chatId = queryFirst("SELECT value FROM system_settings WHERE key = 'komari_notify_chat_id'") as { value: string } | null
    const webhookUrl = queryFirst("SELECT value FROM system_settings WHERE key = 'komari_notify_webhook_url'") as { value: string } | null
    const webhookBody = queryFirst("SELECT value FROM system_settings WHERE key = 'komari_notify_webhook_body'") as { value: string } | null

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

    run("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('komari_notify_enabled', ?, datetime('now'))", [enabled ? '1' : '0'])
    run("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('komari_notify_chat_id', ?, datetime('now'))", [chat_id || ''])
    run("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('komari_notify_webhook_url', ?, datetime('now'))", [webhook_url || ''])
    run("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('komari_notify_webhook_body', ?, datetime('now'))", [webhook_body || ''])

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

    // 清理 HTML 标签
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

    const cleanTitle = stripHtml(title || '')
    const cleanMessage = stripHtml(message || '')

    console.log(`📩 收到 Komari 通知: ${cleanTitle || '(无标题)'} - ${cleanMessage?.substring(0, 50) || '(无内容)'}...`)

    // 检查是否启用
    const enabledResult = queryFirst("SELECT value FROM system_settings WHERE key = 'komari_notify_enabled'") as { value: string } | null
    if (enabledResult?.value !== '1') {
      return res.json({ success: true, message: 'Komari 通知已禁用，忽略' })
    }

    // 获取 TG 群组 ID（全局配置）
    const chatIdResult = queryFirst("SELECT value FROM system_settings WHERE key = 'komari_notify_chat_id'") as { value: string } | null
    const chatId = chatIdResult?.value || ''

    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

    // 判断是离线还是恢复（根据关键词）
    const textLower = text.toLowerCase()
    const isOffline = textLower.includes('离线') || textLower.includes('offline') || textLower.includes('down') || textLower.includes('掉线')
    const isRecovery = textLower.includes('恢复') || textLower.includes('上线') || textLower.includes('online') || textLower.includes('recovery') || textLower.includes('up')

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
        ? monitor.expected_keyword.split(',').map(s => s.trim().toLowerCase()).filter(s => s)
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
      console.log(`🔴 检测到离线通知${matchedMonitor ? ` (匹配监控: ${matchedMonitor.name}, 服务器: ${matchedServerName})` : ' (未匹配到监控)'}`)

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
        await sendTgMessage(chatId, offlineMsg, matchedMonitor ? {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 重发 Webhook', callback_data: `retry_webhook:${matchedMonitor.id}` }]
            ]
          }
        } : undefined)
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
            const customHeaders = JSON.parse(matchedMonitor.webhook_headers)
            headers = { ...headers, ...customHeaders }
          }

          if (matchedMonitor.webhook_username) {
            const encodedAuth = Buffer.from(`${matchedMonitor.webhook_username}:`).toString('base64')
            headers['Authorization'] = `Basic ${encodedAuth}`
          }

          console.log(`📤 发送 Webhook: ${matchedMonitor.webhook_url}`)

          // 添加 10 秒超时控制
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000)

          const response = await fetch(matchedMonitor.webhook_url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
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

        console.log(`📤 Webhook 调用 (${matchedMonitor.name}): ${webhookSuccess ? '成功' : '失败 - ' + webhookError}`)
      } else if (matchedMonitor) {
        console.log(`⚠️ 监控项 ${matchedMonitor.name} 未配置 Webhook`)
      }

      res.json({
        success: true,
        type: 'offline',
        matched_monitor: matchedMonitor?.name || null,
        message: matchedMonitor ? `离线通知已处理 (${matchedMonitor.name})` : '离线通知已处理（未匹配到监控）'
      })

    } else if (isRecovery) {
      // ===== 恢复通知 =====
      console.log(`🟢 检测到恢复通知${matchedMonitor ? ` (匹配监控: ${matchedMonitor.name})` : ' (未匹配到监控)'}`)

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
        ? monitor.expected_keyword.split(',').map(s => s.trim()).filter(s => s)
        : null

      // 如果设置了目标服务器，检查是否匹配
      if (targetServers && targetServers.length > 0) {
        const isTarget = targetServers.some(target =>
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
          run(
            'INSERT INTO incidents (monitor_id, started_at, notified) VALUES (?, ?, 1)',
            [monitor.id, new Date().toISOString()]
          )
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

          run(
            'UPDATE incidents SET resolved_at = ?, duration_seconds = ? WHERE id = ?',
            [resolvedAt, durationSeconds, incident.id]
          )
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

    const data = await response.json() as any

    if (data.status !== 'success') {
      return res.status(502).json({ error: data.message || 'Komari API error' })
    }

    const offlineThreshold = (monitor.komari_offline_threshold || 3) * 60 * 1000
    const now = Date.now()
    const targetServers = monitor.expected_keyword
      ? monitor.expected_keyword.split(',').map((s: string) => s.trim()).filter((s: string) => s)
      : null

    const servers = data.data.map((server: any) => {
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
    }).filter(Boolean)

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
    const enabled = queryFirst("SELECT value FROM system_settings WHERE key = 'nezha_notify_enabled'") as { value: string } | null
    const chatId = queryFirst("SELECT value FROM system_settings WHERE key = 'nezha_notify_chat_id'") as { value: string } | null

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

    run("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('nezha_notify_enabled', ?, datetime('now'))", [enabled ? '1' : '0'])
    run("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('nezha_notify_chat_id', ?, datetime('now'))", [chat_id || ''])

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
    const enabledResult = queryFirst("SELECT value FROM system_settings WHERE key = 'nezha_notify_enabled'") as { value: string } | null
    if (enabledResult?.value !== '1') {
      return res.json({ success: true, message: 'Nezha 通知接收已禁用' })
    }

    // 2. 解析状态 (简单关键词匹配)
    const textLower = text.toLowerCase()
    const isOffline = textLower.includes('离线') || textLower.includes('offline') || textLower.includes('down')
    const isRecovery = textLower.includes('上线') || textLower.includes('online') || textLower.includes('up') || textLower.includes('恢复')

    if (!isOffline && !isRecovery) {
      return res.json({ success: true, message: '未识别的状态变化，忽略' })
    }

    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const chatIdResult = queryFirst("SELECT value FROM system_settings WHERE key = 'nezha_notify_chat_id'") as { value: string } | null
    const chatId = chatIdResult?.value || ''

    // 3. 全局 TG 通知
    if (chatId) {
      const icon = isOffline ? '🔴' : '🟢'
      const title = isOffline ? '服务器离线报警' : '服务器恢复通知'
      // 使用更紧凑的排版
      const fullMsg = `${icon} *[Nezha] ${title}*\n\n🖥️ **${serverName}**\n📜 ${text}\n\n🕒 ${timeStr}`
      await sendTgMessage(chatId, fullMsg)
    }

    // 4. 匹配监控项并更新状态
    // 查找所有 check_type = 'nezha_webhook' 的监控项
    const monitors = queryAll(
      "SELECT * FROM monitors WHERE check_type = 'nezha_webhook' AND is_active = 1"
    ) as Monitor[]

    let matchedMonitor: Monitor | null = null

    for (const monitor of monitors) {
      // 使用 expected_keyword 存储 Nezha 的 server_name
      if (monitor.expected_keyword && monitor.expected_keyword.trim() === serverName) {
        matchedMonitor = monitor
        break
      }
    }

    if (matchedMonitor) {
      if (isOffline) {
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
      } else if (isRecovery) {
        const checkData: MonitorCheck = {
          monitor_id: matchedMonitor.id,
          status: 'up',
          response_time: 0,
          status_code: 200,
          error_message: '',
          checked_at: new Date().toISOString()
        }
        saveCheck(checkData)
        await handleUpStatus(matchedMonitor, checkData)
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
app.post('/api/callback/:monitorId', async (req, res) => {
  try {
    const { monitorId } = req.params
    const { remaining_time, status, message } = req.body

    // 1. 获取监控项
    const monitor = queryFirst('SELECT * FROM monitors WHERE id = ?', [monitorId]) as Monitor
    if (!monitor) {
      return res.status(404).json({ error: '监控项不存在' })
    }

    console.log(`📡 收到反馈联动回调: [${monitor.name}] 剩余时间: ${remaining_time}s, 状态: ${status || '无'}`)

    // 2. 计算下一次检查时间
    const now = Date.now()
    let nextCheckAt: string

    // 灵活阈值：如果有最大值，则在区间内随机取值
    const minThreshold = monitor.feedback_threshold || 0
    const maxThreshold = monitor.feedback_threshold_max || minThreshold

    let actualThresholdHours = minThreshold
    if (maxThreshold > minThreshold) {
      actualThresholdHours = Math.random() * (maxThreshold - minThreshold) + minThreshold
    }

    const thresholdSeconds = actualThresholdHours * 3600

    if ((monitor.feedback_linkage || monitor.check_type === 'feedback_linkage') && remaining_time !== undefined && remaining_time > thresholdSeconds) {
      // 剩余时间充足，等待到接近阈值时再试
      // 即：现在 + (剩余时间 - 阈值)
      const waitSeconds = remaining_time - thresholdSeconds
      nextCheckAt = new Date(now + waitSeconds * 1000).toISOString()
    } else {
      // 已经进入续期窗口，或者未开启联动，或者没有返回有效时间
      // 使用监控项自带的随机间隔重试
      const checkInterval = monitor.check_interval || 5
      const checkIntervalMax = monitor.check_interval_max
      let nextInterval = checkInterval
      if (checkIntervalMax && checkIntervalMax > checkInterval) {
        nextInterval = Math.floor(Math.random() * (checkIntervalMax - checkInterval + 1)) + checkInterval
      }
      nextCheckAt = new Date(now + nextInterval * 60 * 1000).toISOString()
    }

    // 3. 更新监控项状态和下次检查时间
    run(
      'UPDATE monitors SET next_check_at = ?, updated_at = ? WHERE id = ?',
      [nextCheckAt, new Date().toISOString(), monitorId]
    )

    // 4. 记录一次 Check (作为被动更新的凭据)
    // 如果返回了 status，以 status 为准；否则根据 remaining_time > 0 判断
    const isSuccess = status ? (status === 'success' || status === 'up') : (remaining_time !== undefined && remaining_time > 0)

    const checkData: MonitorCheck = {
      monitor_id: monitorId,
      status: isSuccess ? 'up' : 'down',
      response_time: 0,
      status_code: isSuccess ? 200 : 500,
      error_message: message || (remaining_time !== undefined ? `收到反馈: 剩余 ${remaining_time}s` : '收到反馈回调'),
      checked_at: new Date().toISOString()
    }
    saveCheck(checkData)

    // 5. 如果状态是失败，触发告警逻辑
    if (!isSuccess) {
      await handleDownStatus(monitor, checkData)
    } else {
      await handleUpStatus(monitor, checkData)
    }

    res.json({
      success: true,
      message: '反馈已接收',
      next_check_at: nextCheckAt
    })
  } catch (error: any) {
    console.error('Error processing callback:', error)
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
    run(
      'UPDATE admin_credentials SET password_hash = ?, updated_at = ? WHERE id = 1',
      [newHash, new Date().toISOString()]
    )
    console.log('🔐 密码已通过环境变量 RESET_PASSWORD 重置')
    console.log('⚠️  请移除 RESET_PASSWORD 环境变量后重启容器以确保安全')
  }

  // 初始化 Telegram Bot（如果配置了 Token）
  initTelegramBot()

  // 启动定时任务 - 每分钟检查一次，根据各监控的间隔决定是否执行
  cron.schedule('* * * * *', () => {
    console.log('Running scheduled monitor check...')
    checkAllMonitors()
  })

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log('Monitor check scheduled every minute (respects individual intervals)')

    // 启动时执行一次检查
    checkAllMonitors()
  })

  // 优雅关闭
  process.on('SIGTERM', () => {
    stopTelegramBot()
    process.exit(0)
  })
}

start().catch(console.error)

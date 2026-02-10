import { queryAll, queryFirst, run, saveDatabase } from './db.js'
import { Monitor, MonitorCheck, KomariApiResponse } from './types.js'
import { sendTgMessage } from './telegram.js'
import { sendWebhookNotification } from './webhook-sender.js'
import crypto from 'crypto'

// 缓存最新检查结果
const latestChecks = new Map<string, MonitorCheck>()

export function getLatestCheck(monitorId: string): MonitorCheck | undefined {
  return latestChecks.get(monitorId)
}

// 生成随机间隔（分钟）
function getRandomInterval(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export async function checkAllMonitors() {
  try {
    // 排除 telegram 和 komari_webhook 类型，它们是被动接收通知的
    const monitors = queryAll(
      "SELECT * FROM monitors WHERE is_active = 1 AND check_type NOT IN ('telegram', 'komari_webhook')"
    ) as Monitor[]
    const now = Date.now()

    for (const monitor of monitors) {
      // 1. 如果没有 next_check_at (遗留数据或新创建)，初始化它
      if (!monitor.next_check_at) {
        // 如果有上次检查，下一次 = 上次 + 间隔
        // 如果没有上次检查（新监控），下一次 = 现在
        // 为了安全起见，我们先初始化为 "现在"，让它立即跑一次，或者根据逻辑推迟

        let nextCheck = now
        const lastCheck = queryFirst(
          'SELECT checked_at FROM monitor_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1',
          [monitor.id]
        ) as { checked_at: string } | undefined

        if (lastCheck) {
          // 基础间隔（分钟）
          let intervalMinutes = monitor.check_interval || 5
          // 如果是随机间隔模式，取个随机值
          if ((monitor.check_type === 'http' || monitor.check_type === 'scheduled_webhook') && monitor.check_interval_max && monitor.check_interval_max > monitor.check_interval) {
            intervalMinutes = getRandomInterval(monitor.check_interval, monitor.check_interval_max)
          }
          nextCheck = new Date(lastCheck.checked_at).getTime() + (intervalMinutes * 60 * 1000)
        }

        // 立即保存到 DB，防止重复计算
        const nextCheckStr = new Date(nextCheck).toISOString()
        run("UPDATE monitors SET next_check_at = ? WHERE id = ?", [nextCheckStr, monitor.id])
        console.log(`Initialized next_check_at for ${monitor.name} to ${nextCheckStr}`)

        // 如果时间未到，跳过本次
        if (nextCheck > now) continue
      } else {
        // 2. 如果有 next_check_at，判断时间是否已到
        const nextCheckTime = new Date(monitor.next_check_at).getTime()
        if (now < nextCheckTime) {
          continue
        }
      }

      // 执行检查
      await checkMonitor(monitor)
    }
  } catch (error) {
    console.error('Error checking monitors:', error)
  }
}

export async function checkMonitor(monitor: Monitor) {
  const startTime = Date.now()
  let status: 'up' | 'down' = 'down'
  let statusCode = 0
  let errorMessage = ''

  const timeout = (monitor.check_timeout || 30) * 1000
  const checkType = monitor.check_type || 'http'

  // Telegram 类型不执行主动检查，只通过消息被动更新状态
  if (checkType === 'telegram') {
    return // 跳过，状态由 telegram.ts 处理
  }

  try {
    if (checkType === 'tcp') {
      const result = await checkTCP(monitor.url, timeout)
      status = result.success ? 'up' : 'down'
      errorMessage = result.error || ''
    } else if (checkType === 'komari') {
      const result = await checkKomari(monitor, timeout)
      status = result.success ? 'up' : 'down'
      errorMessage = result.error || ''
      statusCode = result.statusCode
    } else {
      const result = await checkHTTP(monitor, timeout)
      statusCode = result.statusCode

      if (result.success) {
        const expectedCodes = (monitor.expected_status_codes || '200,201,204,301,302')
          .split(',')
          .map(c => parseInt(c.trim()))

        if (expectedCodes.includes(statusCode)) {
          if (monitor.forbidden_keyword && monitor.forbidden_keyword.trim()) {
            if (result.body && result.body.includes(monitor.forbidden_keyword)) {
              errorMessage = `检测到禁止关键词 "${monitor.forbidden_keyword}"`
              status = 'down'
            } else {
              status = 'up'
            }
          } else if (monitor.expected_keyword && monitor.expected_keyword.trim()) {
            if (result.body && result.body.includes(monitor.expected_keyword)) {
              status = 'up'
            } else {
              errorMessage = `关键词 "${monitor.expected_keyword}" 未找到`
            }
          } else {
            status = 'up'
          }
        } else {
          errorMessage = `状态码 ${statusCode} 不在期望列表中`
        }
      } else {
        errorMessage = result.error || `HTTP ${statusCode}`
      }
    }
  } catch (error: any) {
    errorMessage = error.message || 'Request failed'
  }

  const responseTime = Date.now() - startTime

  // 反馈联动类型的特殊处理：成功通常意味着 remaining_time > 0
  if (checkType === 'feedback_linkage') {
    // 主动检查（触发脚本）时，状态通常标记为 up，直到回调返回故障
    // 这里保持默认逻辑，如果 HTTP 触发成功即为 up
    if (errorMessage === '') status = 'up'
  }

  const checkData: MonitorCheck = {
    monitor_id: monitor.id,
    status,
    response_time: responseTime,
    status_code: statusCode,
    error_message: errorMessage,
    checked_at: new Date().toISOString()
  }

  // 保存到内存缓存
  latestChecks.set(monitor.id, checkData)

  // 保存到数据库
  saveCheck(checkData)

  if (status === 'down') {
    await handleDownStatus(monitor, checkData)
  } else {
    await handleUpStatus(monitor, checkData)
  }

  // Scheduled Webhook & Feedback Linkage: Always notify on execution
  if ((checkType === 'scheduled_webhook' || checkType === 'feedback_linkage') && monitor.tg_notify_chat_id) {
    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const icon = status === 'up' ? '✅' : '❌'
    const statusText = status === 'up' ? '成功' : '失败'
    const typeLabel = checkType === 'feedback_linkage' ? '反馈联动任务' : '定时任务'

    // Format headers and body for display if needed, or just keep simple
    const msg = [
      `${icon} *${typeLabel}执行: ${statusText}*`,
      ``,
      `📋 *任务:* ${monitor.name}`,
      `🔗 *URL:* ${monitor.url}`,
      `⏱ *耗时:* ${responseTime}ms`,
      `🔢 *状态码:* ${statusCode}`,
      status === 'down' ? `⚠️ *错误:* ${errorMessage}` : '',
      ``,
      `\`⏰ ${timeStr}\``
    ].filter(Boolean).join('\n')

    await sendTgMessage(monitor.tg_notify_chat_id, msg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 立即重试', callback_data: `retry_scheduled:${monitor.id}` }]
        ]
      }
    })
  }

  // ---------------------------------------------------------
  // 关键改动：检查完成后，立即计算并持久化 下一次检查时间
  // ---------------------------------------------------------
  let nextIntervalMinutes = monitor.check_interval || 5

  if (monitor.feedback_linkage || monitor.check_type === 'feedback_linkage') {
    // 反馈联动模式：设置一个较大的安全冗余时间 (例如 6 小时)，防止回调没到导致任务永久停滞
    // 正常情况下，回调会很快回来并覆盖这个时间
    nextIntervalMinutes = 360 // 6 小时保底
    console.log(`Monitor ${monitor.name}: Feedback Linkage enabled. Safety fallback set to 6h.`)
  } else if ((monitor.check_type === 'http' || monitor.check_type === 'scheduled_webhook') && monitor.check_interval_max && monitor.check_interval_max > monitor.check_interval) {
    nextIntervalMinutes = getRandomInterval(monitor.check_interval, monitor.check_interval_max)
    console.log(`Monitor ${monitor.name}: Random interval generated for next run: ${nextIntervalMinutes}m`)
  }

  const nextCheckTime = new Date(Date.now() + (nextIntervalMinutes * 60 * 1000)).toISOString()
  run("UPDATE monitors SET next_check_at = ? WHERE id = ?", [nextCheckTime, monitor.id])
  console.log(`Monitor ${monitor.name}: Scheduled next check at ${nextCheckTime}`)
}

async function checkHTTP(monitor: Monitor, timeout: number): Promise<{
  success: boolean
  statusCode: number
  body?: string
  error?: string
}> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const method = monitor.check_method || 'GET'

    const headers = {
      'User-Agent': 'UptimeMonitor/1.0',
      ...(monitor.check_content_type ? { 'Content-Type': monitor.check_content_type } : {}),
      ...(monitor.check_headers ? JSON.parse(monitor.check_headers) : {})
    }

    const requestBody = (method === 'POST' || method === 'PUT' || method === 'PATCH') && monitor.check_body
      ? JSON.stringify(JSON.parse(monitor.check_body))
      : undefined

    console.log(`[DEBUG] Executing HTTP Check for ${monitor.name}:`)
    console.log(`[DEBUG] URL: ${monitor.url}`)
    console.log(`[DEBUG] Method: ${method}`)
    console.log(`[DEBUG] Headers:`, headers)
    console.log(`[DEBUG] Body:`, requestBody)

    const response = await fetch(monitor.url, {
      method,
      signal: controller.signal,
      headers,
      body: requestBody,
      redirect: 'follow'
    })

    clearTimeout(timeoutId)

    let body = ''
    const needBody = (monitor.expected_keyword || monitor.forbidden_keyword) && method !== 'HEAD'
    if (needBody) {
      try {
        body = await response.text()
      } catch {
        body = ''
      }
    }

    return {
      success: true,
      statusCode: response.status,
      body
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { success: false, statusCode: 0, error: `超时 (${timeout / 1000}秒)` }
    }
    return { success: false, statusCode: 0, error: error.message }
  }
}

async function checkTCP(url: string, timeout: number): Promise<{
  success: boolean
  error?: string
}> {
  try {
    let targetUrl = url
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      targetUrl = `https://${url}`
    }

    const parsedUrl = new URL(targetUrl)
    const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const testUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}:${port}`

    await fetch(testUrl, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual'
    })

    clearTimeout(timeoutId)
    return { success: true }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { success: false, error: `连接超时 (${timeout / 1000}秒)` }
    }
    if (error.message.includes('Failed to fetch') ||
      error.message.includes('connection') ||
      error.message.includes('ECONNREFUSED')) {
      return { success: false, error: '连接失败' }
    }
    return { success: true }
  }
}

async function checkKomari(monitor: Monitor, timeout: number): Promise<{
  success: boolean
  statusCode: number
  error?: string
}> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(monitor.url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'UptimeMonitor/1.0'
      }
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: `Komari API 返回 ${response.status}`
      }
    }

    const data = await response.json() as KomariApiResponse

    if (data.status !== 'success') {
      return {
        success: false,
        statusCode: response.status,
        error: `Komari API 错误: ${data.message || '未知错误'}`
      }
    }

    const offlineThreshold = (monitor.komari_offline_threshold || 5) * 60 * 1000
    const now = Date.now()
    const offlineServers: string[] = []

    const targetServers = monitor.expected_keyword
      ? monitor.expected_keyword.split(',').map(s => s.trim()).filter(s => s)
      : null

    for (const server of data.data) {
      if (targetServers && targetServers.length > 0) {
        const isTarget = targetServers.some(target => server.name === target)
        if (!isTarget) continue
      }

      const updatedAt = new Date(server.updated_at).getTime()
      const timeSinceUpdate = now - updatedAt

      if (timeSinceUpdate > offlineThreshold) {
        const minutesOffline = Math.floor(timeSinceUpdate / 60000)
        offlineServers.push(`${server.region}${server.name}(${minutesOffline}分钟)`)
      }
    }

    if (offlineServers.length > 0) {
      return {
        success: false,
        statusCode: response.status,
        error: `离线服务器: ${offlineServers.join(', ')}`
      }
    }

    return {
      success: true,
      statusCode: response.status
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { success: false, statusCode: 0, error: `超时 (${timeout / 1000}秒)` }
    }
    return { success: false, statusCode: 0, error: error.message }
  }
}

export function saveCheck(check: MonitorCheck) {
  run(
    `INSERT INTO monitor_checks (monitor_id, status, response_time, status_code, error_message, checked_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [check.monitor_id, check.status, check.response_time, check.status_code, check.error_message, check.checked_at]
  )
}

export async function handleDownStatus(monitor: Monitor, check: MonitorCheck) {
  const incidents = queryAll('SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL', [monitor.id]) as any[]

  if (!incidents || incidents.length === 0) {
    // 对于 Komari 监控，检查最近的检查记录来确认是否连续失败
    if (monitor.check_type === 'komari') {
      const recentChecks = queryAll(
        'SELECT status FROM monitor_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 2',
        [monitor.id]
      ) as { status: string }[]

      // 需要至少2次连续失败才创建事件和发送通知
      const consecutiveFailures = recentChecks.filter(c => c.status === 'down').length
      if (consecutiveFailures < 2) {
        console.log(`Komari monitor ${monitor.name}: waiting for consecutive failures (${consecutiveFailures}/2)`)
        return
      }
    }

    run(
      `INSERT INTO incidents (monitor_id, started_at, notified) VALUES (?, ?, 0)`,
      [monitor.id, new Date().toISOString()]
    )

    if (monitor.webhook_url) {
      await sendWebhookNotification(monitor, check, 'down')
    }

    // Komari 监控：发送 TG 群组通知
    if (monitor.check_type === 'komari' && monitor.tg_notify_chat_id) {
      const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      const msg = [
        `🔴 *CloudEye 告警通知*`,
        ``,
        `📊 *监控项:* ${monitor.name}`,
        `🚨 *状态:* 离线`,
        `⚠️ *原因:* ${check.error_message || '未知'}`,
        ``,
        `\`⏰ ${timeStr}\``
      ].join('\n')
      await sendTgMessage(monitor.tg_notify_chat_id, msg, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 重发 Webhook', callback_data: `retry_webhook:${monitor.id}` }]
          ]
        }
      })
    }
  }
}

export async function handleUpStatus(monitor: Monitor, check: MonitorCheck) {
  const incidents = queryAll('SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL', [monitor.id]) as any[]

  if (incidents && incidents.length > 0) {
    const incident = incidents[0]
    const resolvedAt = new Date().toISOString()
    const startedAt = new Date(incident.started_at)
    const durationSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000)

    run(
      `UPDATE incidents SET resolved_at = ?, duration_seconds = ? WHERE id = ?`,
      [resolvedAt, durationSeconds, incident.id]
    )

    if (monitor.webhook_url) {
      await sendWebhookNotification(monitor, {
        monitor_id: monitor.id,
        status: 'up',
        response_time: 0,
        status_code: 200,
        error_message: '',
        checked_at: resolvedAt
      }, 'recovered')
    }

    // Komari 监控：发送 TG 群组恢复通知
    if (monitor.check_type === 'komari' && monitor.tg_notify_chat_id) {
      const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      const durationMin = Math.floor(durationSeconds / 60)
      const msg = [
        `🟢 *CloudEye 恢复通知*`,
        ``,
        `📊 *监控项:* ${monitor.name}`,
        `✅ *状态:* 已恢复`,
        `⏱ *故障时长:* ${durationMin} 分钟`,
        ``,
        `\`⏰ ${timeStr}\``
      ].join('\n')
      await sendTgMessage(monitor.tg_notify_chat_id, msg)
    }
  }
}

// Webhook Logic moved to ./webhook-sender.ts

// 密码相关函数
export async function hashPassword(password: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(password).digest('base64')
  return hash
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password)
  return passwordHash === hash
}

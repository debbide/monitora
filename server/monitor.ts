import { queryAll, queryFirst, run, saveDatabase } from './db.js'
import { Monitor, MonitorCheck, KomariApiResponse } from './types.js'
import { sendTgMessage } from './telegram.js'
import { sendWebhookNotification } from './webhook-sender.js'
import crypto from 'crypto'

// 缓存最新检查结果
const latestChecks = new Map<string, MonitorCheck>()
// 缓存每个监控的下次检查间隔（用于随机间隔）
const nextCheckIntervals = new Map<string, number>()

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
      // 获取上次检查时间
      const lastCheck = queryFirst(
        'SELECT checked_at FROM monitor_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1',
        [monitor.id]
      ) as { checked_at: string } | undefined

      // 确定本次使用的检查间隔
      let checkIntervalMinutes: number

      // 只有 HTTP 模式且设置了 check_interval_max 才使用随机间隔
      if (monitor.check_type === 'http' && monitor.check_interval_max && monitor.check_interval_max > monitor.check_interval) {
        // 使用缓存的间隔，如果没有则生成新的
        if (nextCheckIntervals.has(monitor.id)) {
          checkIntervalMinutes = nextCheckIntervals.get(monitor.id)!
        } else {
          checkIntervalMinutes = getRandomInterval(monitor.check_interval, monitor.check_interval_max)
          nextCheckIntervals.set(monitor.id, checkIntervalMinutes)
        }
      } else {
        checkIntervalMinutes = monitor.check_interval || 5
      }

      const checkInterval = checkIntervalMinutes * 60 * 1000 // 转换为毫秒

      // 如果有上次检查记录，检查是否超过间隔
      if (lastCheck) {
        const lastCheckTime = new Date(lastCheck.checked_at).getTime()
        const timeSinceLastCheck = now - lastCheckTime

        if (timeSinceLastCheck < checkInterval) {
          // 还没到检查时间，跳过
          continue
        }
      }

      // 执行检查前，为下次生成新的随机间隔
      if (monitor.check_type === 'http' && monitor.check_interval_max && monitor.check_interval_max > monitor.check_interval) {
        const newInterval = getRandomInterval(monitor.check_interval, monitor.check_interval_max)
        nextCheckIntervals.set(monitor.id, newInterval)
        console.log(`Monitor ${monitor.name}: next check in ${newInterval} minutes (random ${monitor.check_interval}-${monitor.check_interval_max})`)
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

    const response = await fetch(monitor.url, {
      method,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'UptimeMonitor/1.0'
      }
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

function saveCheck(check: MonitorCheck) {
  run(
    `INSERT INTO monitor_checks (monitor_id, status, response_time, status_code, error_message, checked_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [check.monitor_id, check.status, check.response_time, check.status_code, check.error_message, check.checked_at]
  )
}

async function handleDownStatus(monitor: Monitor, check: MonitorCheck) {
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

async function handleUpStatus(monitor: Monitor, check: MonitorCheck) {
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

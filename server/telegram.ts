/**
 * Telegram Bot 监听模块
 * 监听群组消息，根据关键词判断服务状态
 */

import TelegramBot from 'node-telegram-bot-api'
import { queryAll, queryFirst, run, saveDatabase } from './db.js'
import { Monitor, MonitorCheck } from './types.js'
import { sendWebhookNotification } from './webhook-sender.js'

// Bot 实例
let bot: TelegramBot | null = null
let currentToken: string = ''

// 已处理的消息 ID（防重复）
const processedMessages = new Set<string>()
const MAX_PROCESSED_MESSAGES = 1000

// 最近状态变更记录（防止短时间内重复处理，使用 TG 消息时间戳）
const recentChanges = new Map<string, number>()
const CHANGE_COOLDOWN = 60 // 1分钟冷却（单位：秒，与 TG msg.date 一致）

export function cleanRecentChanges(): void {
  const now = Math.floor(Date.now() / 1000)
  for (const [key, ts] of recentChanges) {
    if (now - ts > CHANGE_COOLDOWN * 10) recentChanges.delete(key)
  }
}

/**
 * 获取存储的 TG Bot Token
 */
export function getTgBotToken(): string {
    const result = queryFirst(
        "SELECT value FROM system_settings WHERE key = 'tg_bot_token'"
    ) as { value: string } | null
    return result?.value || ''
}

/**
 * 验证 TG Bot Token 是否有效
 */
async function validateToken(token: string): Promise<{ valid: boolean; botName?: string; error?: string }> {
    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
            method: 'GET',
            headers: { 'User-Agent': 'UptimeMonitor/1.0' }
        })

        const data = await response.json()

        if (data.ok && data.result) {
            return { valid: true, botName: data.result.username }
        } else {
            return { valid: false, error: data.description || 'Token 无效' }
        }
    } catch (error: any) {
        return { valid: false, error: error.message }
    }
}

/**
 * 设置 TG Bot Token 并重新初始化 Bot
 */
export async function setTgBotToken(token: string): Promise<{ success: boolean; message: string }> {
    // 如果有 Token，先验证有效性
    if (token) {
        const validation = await validateToken(token)
        if (!validation.valid) {
            return { success: false, message: `Token 无效: ${validation.error}` }
        }
        console.log(`✅ Token 验证成功，Bot: @${validation.botName}`)
    }

    // 保存到数据库
    run(
        `INSERT OR REPLACE INTO system_settings (key, value, updated_at) 
         VALUES ('tg_bot_token', ?, datetime('now'))`,
        [token]
    )

    // 重新初始化 Bot
    stopTelegramBot()

    if (token) {
        const result = initTelegramBot()
        if (result) {
            return { success: true, message: 'Token 验证通过，Bot 已启动！' }
        } else {
            return { success: false, message: 'Bot 启动失败' }
        }
    }

    return { success: true, message: 'Token 已清除，Bot 已停止' }
}

/**
 * 初始化 Telegram Bot
 */
export function initTelegramBot(): boolean {
    const token = getTgBotToken()

    if (!token) {
        console.log('ℹ️ TG Bot Token 未设置，Telegram 监控功能已禁用')
        return false
    }

    try {
        // 如果已有 Bot 且 Token 相同，不重复初始化
        if (bot && currentToken === token) {
            return true
        }

        // 停止旧的 Bot
        if (bot) {
            bot.stopPolling()
        }

        bot = new TelegramBot(token, { polling: true })
        currentToken = token

        console.log('🤖 Telegram Bot 已启动')

        // 监听所有消息
        bot.on('message', handleMessage)

        // 监听 Callback Query (按钮点击)
        bot.on('callback_query', handleCallbackQuery)

        // 错误处理
        bot.on('polling_error', (error) => {
            console.error('❌ TG Bot Polling 错误:', error.message)
        })

        return true
    } catch (error: any) {
        console.error('❌ TG Bot 初始化失败:', error.message)
        return false
    }
}

/**
 * 处理收到的消息
 */
async function handleMessage(msg: TelegramBot.Message) {
    const chatId = msg.chat.id.toString()
    const messageId = `${chatId}_${msg.message_id}`
    const text = msg.text || ''
    const chatTitle = msg.chat.title || '私聊'

    // 消息 ID 去重
    if (processedMessages.has(messageId)) {
        return
    }
    processedMessages.add(messageId)

    // 限制 Set 大小
    if (processedMessages.size > MAX_PROCESSED_MESSAGES) {
        const first = processedMessages.values().next().value
        if (first) {
            processedMessages.delete(first)
        }
    }

    // 查找监听此群组的 Telegram 类型监控
    const monitors = queryAll(
        "SELECT * FROM monitors WHERE check_type = 'telegram' AND is_active = 1 AND tg_chat_id = ?",
        [chatId]
    ) as Monitor[]

    if (monitors.length === 0) {
        return // 没有监控项监听这个群组
    }

    for (const monitor of monitors) {
        await processMonitorMessage(monitor, text, chatTitle, msg)
    }
}

/**
 * 处理单个监控的消息匹配
 */
async function processMonitorMessage(
    monitor: Monitor,
    text: string,
    chatTitle: string,
    msg: TelegramBot.Message
) {
    const textLower = text.toLowerCase()

    // 使用 tg_server_name 进行匹配（支持多个服务器名称，逗号分隔）
    // 如果未设置 tg_server_name，则跳过匹配
    const serverNames = (monitor.tg_server_name || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s)

    if (serverNames.length === 0) {
        return // 未设置服务器名称，跳过
    }

    // 检查消息是否包含任意一个服务器名称
    const matchedServerName = serverNames.find(name => textLower.includes(name))
    if (!matchedServerName) {
        return // 不包含任何服务器名称，跳过
    }

    // 解析关键词
    const offlineKeywords = (monitor.tg_offline_keywords || '离线,offline,down,掉线')
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(k => k)

    const onlineKeywords = (monitor.tg_online_keywords || '上线,online,up,恢复')
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(k => k)

    // 检测状态（服务器名称已匹配，再检查关键词）
    const isOffline = offlineKeywords.some(kw => textLower.includes(kw))
    const isOnline = onlineKeywords.some(kw => textLower.includes(kw))

    if (!isOffline && !isOnline) {
        return // 服务器名称匹配但不包含状态关键词
    }

    // 如果同时包含离线和上线关键词，以离线优先
    const newStatus = isOffline ? 'down' : 'up'

    // 防重复：使用 TG 消息时间戳检查冷却时间
    const msgTimestamp = msg.date // TG 消息时间戳（秒级 Unix 时间戳）
    const changeKey = `${monitor.id}_${newStatus}`
    const lastChange = recentChanges.get(changeKey)
    if (lastChange && msgTimestamp - lastChange < CHANGE_COOLDOWN) {
        return // 冷却中
    }

    // 获取当前状态
    const lastCheck = queryFirst(
        'SELECT status FROM monitor_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1',
        [monitor.id]
    ) as { status: string } | null

    // 防重复：状态相同不处理
    if (lastCheck && lastCheck.status === newStatus) {
        return
    }

    // 记录本次变更（使用 TG 消息时间戳）
    recentChanges.set(changeKey, msgTimestamp)

    console.log(`📩 [${chatTitle}] 检测到 "${monitor.name}" (服务器: ${matchedServerName}) 状态变更: ${newStatus.toUpperCase()}`)
    console.log(`   消息内容: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`)

    // 保存检查记录
    const now = new Date().toISOString()
    run(
        `INSERT INTO monitor_checks (monitor_id, status, response_time, status_code, error_message, checked_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
        [
            monitor.id,
            newStatus,
            0,
            0,
            newStatus === 'down' ? `TG 通知: ${text.substring(0, 100)}` : '',
            now
        ]
    )

    // 处理事件
    if (newStatus === 'down') {
        await handleDownStatus(monitor, text, now)
    } else {
        await handleUpStatus(monitor, now)
    }

    // 发送群组确认消息
    if (bot && msg.chat.id) {
        const statusEmoji = newStatus === 'down' ? '🔴' : '🟢'
        const statusText = newStatus === 'down' ? '离线' : '上线'
        const statusAction = newStatus === 'down' ? '⚠️ 已触发告警' : '✅ 状态已恢复'
        const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

        const confirmMsg = [
            `${statusEmoji} <b>CloudEye 监控通知</b>`,
            ``,
            `<b>📊 监控项:</b> ${monitor.name}`,
            `<b>🖥️ 服务器:</b> ${matchedServerName}`,
            `<b>📌 状态:</b> ${statusText} ${statusAction}`,
            ``,
            `<code>⏰ ${timeStr}</code>`
        ].join('\n')

        try {
            await bot.sendMessage(msg.chat.id, confirmMsg, { parse_mode: 'HTML' })
        } catch (err) {
            console.error('发送确认消息失败:', err)
        }
    }
}

/**
 * 处理离线状态
 */
async function handleDownStatus(monitor: Monitor, message: string, timestamp: string) {
    // 检查是否已有未解决的事件
    const existingIncident = queryFirst(
        'SELECT id FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL',
        [monitor.id]
    )

    if (!existingIncident) {
        run(
            'INSERT INTO incidents (monitor_id, started_at, notified) VALUES (?, ?, 1)',
            [monitor.id, timestamp]
        )

        // 发送 Webhook 通知
        if (monitor.webhook_url) {
            await sendWebhook(monitor, 'down', message, timestamp)
        }
    }
}

/**
 * 处理上线状态
 */
async function handleUpStatus(monitor: Monitor, timestamp: string) {
    const incident = queryFirst(
        'SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL',
        [monitor.id]
    ) as any

    if (incident) {
        const startedAt = new Date(incident.started_at)
        const durationSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000)

        run(
            'UPDATE incidents SET resolved_at = ?, duration_seconds = ? WHERE id = ?',
            [timestamp, durationSeconds, incident.id]
        )
        // 注意：上线恢复时不发送 Webhook，避免触发自动启动脚本重复执行
    }
}

/**
 * 发送 Webhook 通知
 */
async function sendWebhook(
    monitor: Monitor,
    status: 'up' | 'down',
    message: string,
    timestamp: string
) {
    const dummyCheck: MonitorCheck = {
        monitor_id: monitor.id,
        status,
        response_time: 0,
        status_code: 0,
        error_message: message,
        checked_at: timestamp
    }

    await sendWebhookNotification(
        monitor,
        dummyCheck,
        status === 'down' ? 'down' : 'recovered'
    )
}

/**
 * 处理 Callback Query (按钮点击)
 */
async function handleCallbackQuery(query: TelegramBot.CallbackQuery) {
    if (!query.data || !query.message) return

    if (query.data.startsWith('retry_webhook:')) {
        const monitorId = query.data.split(':')[1]

        // Anti-spam / Debounce could be added here if needed

        const monitor = queryFirst('SELECT * FROM monitors WHERE id = ?', [monitorId]) as Monitor | undefined

        if (!monitor) {
            bot?.answerCallbackQuery(query.id, { text: '❌ 监控项不存在' })
            return
        }

        if (!monitor.webhook_url) {
            bot?.answerCallbackQuery(query.id, { text: '⚠️ 该监控项未配置 Webhook' })
            return
        }

        // Get latest check to populate the webhook payload
        const latestCheck = queryFirst(
            'SELECT * FROM monitor_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1',
            [monitor.id]
        ) as MonitorCheck | undefined

        if (!latestCheck) {
            bot?.answerCallbackQuery(query.id, { text: '❌ 找不到最近的检查记录' })
            return
        }

        bot?.answerCallbackQuery(query.id, { text: '🔄 正在重发 Webhook...' })

        const type = latestCheck.status === 'down' ? 'down' : 'recovered'

        // Log the manual retry
        console.log(`🔄 Manual webhook retry for ${monitor.name} (initiated by user in TG)`)

        const result = await sendWebhookNotification(monitor, latestCheck, type)

        if (result.success) {
            bot?.sendMessage(query.message.chat.id, `✅ <b>Webhook 重发成功</b>\n📊 监控: ${monitor.name}\n🔗 URL: ${monitor.webhook_url}`, { parse_mode: 'HTML' })
        } else {
            bot?.sendMessage(query.message.chat.id, `❌ <b>Webhook 重发失败</b>\n📊 监控: ${monitor.name}\n⚠️ 原因: ${result.error}`, { parse_mode: 'HTML' })
        }
    } else if (query.data.startsWith('retry_scheduled:')) {
        const monitorId = query.data.split(':')[1]
        const monitor = queryFirst('SELECT * FROM monitors WHERE id = ?', [monitorId]) as Monitor | undefined

        if (!monitor) {
            bot?.answerCallbackQuery(query.id, { text: '❌ 监控项不存在' })
            return
        }

        bot?.answerCallbackQuery(query.id, { text: '🔄 正在立即执行任务...' })

        // 动态导入以避免循环依赖
        const { checkMonitor } = await import('./monitor.js')

        // 执行检查 (monitor.ts 中已包含发送结果的逻辑)
        checkMonitor(monitor)
    }

}

/**
 * 获取 Bot 状态
 */
export function getTelegramBotStatus(): { enabled: boolean; connected: boolean; token: string } {
    const token = getTgBotToken()
    return {
        enabled: !!token,
        connected: bot !== null,
        token: token ? `${token.substring(0, 4)}****` : ''
    }
}

/**
 * 停止 Bot
 */
export function stopTelegramBot() {
    if (bot) {
        bot.stopPolling()
        bot = null
        console.log('👋 Telegram Bot 已停止')
    }
}

/**
 * 发送自定义消息到群组
 */
export async function sendTgMessage(
    chatId: string,
    message: string,
    options?: TelegramBot.SendMessageOptions
): Promise<{ success: boolean; message: string }> {
    if (!bot) {
        return { success: false, message: 'Bot 未启动' }
    }

    try {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options })
        return { success: true, message: '消息已发送' }
    } catch (error: any) {
        return { success: false, message: error.message }
    }
}

/**
 * 测试群组连通性 - 发送测试消息到群组
 */
export async function testChatConnection(chatId: string): Promise<{ success: boolean; message: string }> {
    if (!bot) {
        return { success: false, message: 'Bot 未启动，请先配置 Token' }
    }

    if (!chatId) {
        return { success: false, message: '请输入群组 ID' }
    }

    try {
        const testMsg = [
            '✅ **连接测试成功**',
            '',
            '📊 监控系统已成功连接到此群组',
            `⏰ ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
        ].join('\n')

        await bot.sendMessage(chatId, testMsg, { parse_mode: 'Markdown' })
        return { success: true, message: '测试消息已发送到群组' }
    } catch (error: any) {
        if (error.message?.includes('chat not found')) {
            return { success: false, message: '群组不存在或 Bot 未加入该群组' }
        }
        if (error.message?.includes('bot was kicked')) {
            return { success: false, message: 'Bot 已被踢出该群组' }
        }
        return { success: false, message: `发送失败: ${error.message}` }
    }
}

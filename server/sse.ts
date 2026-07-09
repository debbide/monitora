/**
 * SSE 事件管理器 + 轮询模式支持
 * 用于向浏览器插件推送实时刷新通知
 */

import { Response } from 'express'

interface SSEClient {
    id: string
    res: Response
    connectedAt: Date
}

interface RefreshMessage {
    id: string
    type: string
    url: string
    match: string
    timestamp: number
}

// 已连接的 SSE 客户端
const clients: Map<string, SSEClient> = new Map()

// 轮询模式：待通知消息队列
let pendingRefresh: RefreshMessage | null = null
let messageCounter = 0

/**
 * 添加新的 SSE 客户端连接
 */
export function addClient(clientId: string, res: Response): void {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // 发送连接成功消息
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId, time: new Date().toISOString() })}\n\n`)

    // 保存客户端
    clients.set(clientId, {
        id: clientId,
        res,
        connectedAt: new Date()
    })

    console.log(`📡 SSE 客户端连接: ${clientId} (当前连接数: ${clients.size})`)

    // 定期发送心跳保持连接
    const heartbeat = setInterval(() => {
        if (clients.has(clientId)) {
            res.write(`: heartbeat\n\n`)
        } else {
            clearInterval(heartbeat)
        }
    }, 30000)

    // 处理客户端断开
    res.on('close', () => {
        clients.delete(clientId)
        clearInterval(heartbeat)
        console.log(`👋 SSE 客户端断开: ${clientId} (当前连接数: ${clients.size})`)
    })
}

/**
 * 广播刷新通知给所有客户端（SSE + 轮询）
 */
export function broadcastRefresh(url: string, match: string = 'exact'): void {
    messageCounter++
    const messageId = `${Date.now()}-${messageCounter}`

    // 保存到轮询队列
    pendingRefresh = {
        id: messageId,
        type: 'refresh',
        url,
        match,
        timestamp: Date.now()
    }

    console.log(`📤 广播刷新通知: ${url} -> SSE: ${clients.size} 个客户端, 轮询队列已更新`)

    // SSE 广播
    const message = {
        action: 'refresh',
        url,
        timestamp: new Date().toISOString()
    }
    const data = `event: refresh\ndata: ${JSON.stringify(message)}\n\n`

    clients.forEach((client) => {
        try {
            client.res.write(data)
        } catch (error) {
            console.error(`❌ 发送失败 (${client.id}):`, error)
            clients.delete(client.id)
        }
    })
}

/**
 * 轮询模式：获取待刷新消息
 */
export function pollRefresh(sinceId: string): RefreshMessage | { type: 'none' } {
    if (pendingRefresh && pendingRefresh.id !== sinceId) {
        return pendingRefresh
    }
    return { type: 'none' }
}

/**
 * 获取当前连接的客户端数量
 */
export function getClientCount(): number {
    return clients.size
}

/**
 * 获取所有客户端信息
 */
export function getClients(): { id: string; connectedAt: Date }[] {
    return Array.from(clients.values()).map(c => ({
        id: c.id,
        connectedAt: c.connectedAt
    }))
}


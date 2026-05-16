import { Monitor, MonitorCheck } from './types.js'

type WebhookMethod = 'POST' | 'PUT' | 'PATCH' | 'GET'

export function getWebhookMethod(method: unknown): WebhookMethod {
    const normalized = typeof method === 'string' ? method.toUpperCase() : ''
    return ['POST', 'PUT', 'PATCH', 'GET'].includes(normalized)
        ? (normalized as WebhookMethod)
        : 'POST'
}

export function replaceVariables(template: string, variables: Record<string, any>): string {
    let result = template
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, 'g')
        result = result.replace(regex, String(value))
    }
    return result
}

export function processWebhookBody(body: Record<string, any>, variables: Record<string, any>): Record<string, any> {
    const processed: Record<string, any> = {}

    for (const [key, value] of Object.entries(body)) {
        if (typeof value === 'string') {
            processed[key] = replaceVariables(value, variables)
        } else if (typeof value === 'object' && value !== null) {
            processed[key] = processWebhookBody(value, variables)
        } else {
            processed[key] = value
        }
    }

    return processed
}

export async function sendWebhookNotification(
    monitor: Monitor,
    check: MonitorCheck,
    type: 'down' | 'recovered'
): Promise<{ success: boolean; error?: string }> {
    if (!monitor.webhook_url) return { success: false, error: 'No webhook URL configured' }

    const variables = {
        monitor_name: monitor.name,
        monitor_url: monitor.url,
        status: type,
        error: check.error_message,
        timestamp: check.checked_at,
        response_time: check.response_time.toString(),
        status_code: check.status_code.toString()
    }

    let payload: any
    let headers: Record<string, string> = {}

    if (monitor.webhook_body) {
        try {
            const body = JSON.parse(monitor.webhook_body)
            payload = processWebhookBody(body, variables)
        } catch (e) {
            console.error('Failed to parse webhook body JSON:', e)
            payload = { error: 'Invalid JSON body in configuration' }
        }
    } else {
        payload = {
            monitor: monitor.name,
            url: monitor.url,
            status: type,
            timestamp: check.checked_at,
            response_time: check.response_time,
            status_code: check.status_code,
            error: check.error_message,
            message: type === 'down'
                ? `🚨 ${monitor.name} is DOWN! ${check.error_message}`
                : `✅ ${monitor.name} is back UP!`
        }
    }

    headers['Content-Type'] = monitor.webhook_content_type || 'application/json'

    if (monitor.webhook_headers) {
        try {
            const customHeaders = JSON.parse(monitor.webhook_headers)
            headers = { ...headers, ...customHeaders }
        } catch (e) {
            console.error('Failed to parse webhook headers JSON:', e)
        }
    }

    if (monitor.webhook_username) {
        const encodedAuth = Buffer.from(`${monitor.webhook_username}:`).toString('base64')
        headers['Authorization'] = `Basic ${encodedAuth}`
    }

    try {
        const method = getWebhookMethod(monitor.webhook_method)
        const response = await fetch(monitor.webhook_url, {
            method,
            headers,
            body: method === 'GET' ? undefined : JSON.stringify(payload)
        })

        if (!response.ok) {
            return { success: false, error: `HTTP ${response.status} ${response.statusText}` }
        }

        return { success: true }
    } catch (error: any) {
        console.error('Failed to send webhook:', error)
        return { success: false, error: error.message || 'Unknown error' }
    }
}

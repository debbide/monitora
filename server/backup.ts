import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import cron from 'node-cron'
import { queryFirst, saveNow } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data')
const dbPath = path.join(dataDir, 'monitor.db')

let backupTask: cron.ScheduledTask | null = null

export function getSetting(key: string, defaultValue: string = ''): string {
    const row = queryFirst('SELECT value FROM system_settings WHERE key = ?', [key]) as any
    return row ? row.value : defaultValue
}

export function initBackupScheduler() {
    if (backupTask) {
        backupTask.stop()
        backupTask = null
    }

    const cronExpr = getSetting('backup_cron', '0 3 * * *')
    
    if (!cron.validate(cronExpr)) {
        console.error(`[Backup] Invalid cron expression: ${cronExpr}`)
        return
    }

    backupTask = cron.schedule(cronExpr, () => {
        console.log(`[Backup] Scheduled backup triggered.`)
        performBackup().catch(console.error)
    })
    
    console.log(`[Backup] Scheduler initialized with cron: ${cronExpr}`)
}

export async function performBackup(): Promise<{success: boolean, message: string}> {
    // 强制先落盘
    saveNow()
    
    const tgEnabled = getSetting('backup_tg_enabled', '0') === '1'
    const webdavEnabled = getSetting('backup_webdav_enabled', '0') === '1'
    
    if (!tgEnabled && !webdavEnabled) {
        return { success: false, message: 'No backup destinations enabled.' }
    }

    const tgBotToken = getSetting('tg_bot_token')
    const tgChatId = getSetting('backup_tg_chat_id')
    const webdavUrl = getSetting('backup_webdav_url')
    const webdavUser = getSetting('backup_webdav_user')
    const webdavPassword = getSetting('backup_webdav_password')

    if (!fs.existsSync(dbPath)) {
        return { success: false, message: 'Database file not found.' }
    }

    const fileBuffer = fs.readFileSync(dbPath)
    
    // 生成东八区日期的字符串作为文件名 (防止服务器UTC时间导致文件名差一天)
    const offset = 8 * 60 * 60 * 1000
    const now8 = new Date(Date.now() + offset)
    const dateStr = now8.toISOString().split('T')[0]
    const filename = `monitora_backup_${dateStr}.sqlite`

    let successCount = 0
    let errors: string[] = []

    // ---- Telegram 备份 ----
    if (tgEnabled && tgBotToken && tgChatId) {
        try {
            const formData = new FormData()
            formData.append('chat_id', tgChatId)
            const blob = new Blob([fileBuffer])
            formData.append('document', blob, filename)
            formData.append('caption', `#CloudEyeBackup\nDatabase backup for ${dateStr}`)

            const response = await fetch(`https://api.telegram.org/bot${tgBotToken}/sendDocument`, {
                method: 'POST',
                body: formData
            })
            
            if (response.ok) {
                console.log('[Backup] Successfully pushed to Telegram.')
                successCount++
            } else {
                const result = await response.text()
                console.error('[Backup] Telegram push failed:', result)
                errors.push(`TG Failed: ${response.status}`)
            }
        } catch (e: any) {
            console.error('[Backup] Telegram exception:', e)
            errors.push(`TG Error: ${e.message}`)
        }
    }

    // ---- WebDAV 备份 ----
    if (webdavEnabled && webdavUrl) {
        try {
            const baseUrl = webdavUrl.endsWith('/') ? webdavUrl : webdavUrl + '/'
            const targetUrl = baseUrl + filename

            const headers: Record<string, string> = {}
            if (webdavUser || webdavPassword) {
                const auth = Buffer.from(`${webdavUser}:${webdavPassword}`).toString('base64')
                headers['Authorization'] = `Basic ${auth}`
            }

            const response = await fetch(targetUrl, {
                method: 'PUT',
                headers,
                body: fileBuffer
            })

            if (response.ok || response.status === 201 || response.status === 204) {
                console.log('[Backup] Successfully pushed to WebDAV.')
                successCount++
            } else {
                console.error('[Backup] WebDAV push failed:', response.status, response.statusText)
                errors.push(`WebDAV Failed: ${response.status}`)
            }
        } catch (e: any) {
            console.error('[Backup] WebDAV exception:', e)
            errors.push(`WebDAV Error: ${e.message}`)
        }
    }

    if (successCount > 0) {
        return { success: true, message: `Backup pushed successfully to ${successCount} destinations.` }
    } else {
        return { success: false, message: errors.join(', ') || 'No successful backups.' }
    }
}

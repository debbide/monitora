import { useState, useEffect, useRef } from 'react'
import { getBackupSettings, saveBackupSettings, triggerBackup, restoreBackup } from '../lib/api'

interface BackupSettingsProps {
    onClose: () => void
}

export default function BackupSettings({ onClose }: BackupSettingsProps) {
    const [settings, setSettings] = useState<Record<string, any>>({
        backup_cron: '0 3 * * *',
        backup_tg_enabled: '0',
        backup_tg_chat_id: '',
        backup_webdav_enabled: '0',
        backup_webdav_url: '',
        backup_webdav_user: '',
        backup_webdav_password: ''
    })
    
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [triggering, setTriggering] = useState(false)
    const [message, setMessage] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        loadSettings()
    }, [])

    async function loadSettings() {
        try {
            const data = await getBackupSettings()
            setSettings(prev => ({ ...prev, ...data }))
        } catch (error) {
            console.error('加载备份设置失败:', error)
        } finally {
            setLoading(false)
        }
    }

    async function handleSave() {
        setSaving(true)
        setMessage('')
        try {
            const result = await saveBackupSettings(settings)
            setMessage(result.message)
            if (result.success) {
                setTimeout(() => setMessage(''), 3000)
            }
        } catch (error: any) {
            setMessage('保存失败: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    async function handleTrigger() {
        setTriggering(true)
        setMessage('')
        try {
            const result = await triggerBackup()
            setMessage(result.message)
            setTimeout(() => setMessage(''), 3000)
        } catch (error: any) {
            setMessage('测试推送失败: ' + error.message)
        } finally {
            setTriggering(false)
        }
    }

    async function handleRestore(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return

        if (!confirm('警告：恢复备份将覆盖当前的数据库，并且系统会自动重启！确定要继续吗？')) {
            if (fileInputRef.current) fileInputRef.current.value = ''
            return
        }

        setSaving(true)
        setMessage('正在上传并恢复，请不要关闭页面...')
        try {
            const result = await restoreBackup(file)
            setMessage(result.message)
            
            // 倒计时后自动刷新页面
            let countdown = 3
            const timer = setInterval(() => {
                setMessage(`恢复成功，系统正在重启，${countdown} 秒后刷新页面...`)
                countdown--
                if (countdown <= 0) {
                    clearInterval(timer)
                    window.location.reload()
                }
            }, 1000)

        } catch (error: any) {
            setMessage('恢复失败: ' + error.message)
            setSaving(false)
        }
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    if (loading) {
        return (
            <div className="modal-overlay">
                <div className="modal-content settings-modal">
                    <p>加载中...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
                <h3>备份与恢复</h3>

                <div className="settings-section">
                    <h4>📥 手动操作</h4>
                    <div className="form-group" style={{ flexDirection: 'row', gap: '10px' }}>
                        <a href="/api/backup/download" target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block', lineHeight: 'normal' }}>
                            💾 下载当前数据库
                        </a>
                        <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                            📤 上传恢复数据库
                        </button>
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            style={{ display: 'none' }} 
                            accept=".sqlite,.db" 
                            onChange={handleRestore}
                        />
                    </div>
                    <span className="form-hint" style={{ marginTop: '10px', display: 'block' }}>
                        注意：上传恢复会覆盖现有数据，并导致监控系统重启。
                    </span>
                </div>

                <div className="settings-section" style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                    <h4>⏰ 自动云端备份 (Push)</h4>
                    
                    <div className="form-group">
                        <label>定时规则 (Cron 表达式)</label>
                        <input
                            type="text"
                            value={settings.backup_cron || ''}
                            onChange={(e) => setSettings({ ...settings, backup_cron: e.target.value })}
                            placeholder="例如：0 3 * * * (每天凌晨3点)"
                        />
                    </div>

                    <div className="form-group checkbox-group" style={{ marginTop: '15px' }}>
                        <label>
                            <input
                                type="checkbox"
                                checked={settings.backup_tg_enabled === '1'}
                                onChange={(e) => setSettings({ ...settings, backup_tg_enabled: e.target.checked ? '1' : '0' })}
                            />
                            推送到 Telegram (需在TG设置中配好全局Bot Token)
                        </label>
                    </div>
                    
                    {settings.backup_tg_enabled === '1' && (
                        <div className="form-group">
                            <label>Telegram 目标 Chat ID (可以是您的私人号或群组)</label>
                            <input
                                type="text"
                                value={settings.backup_tg_chat_id || ''}
                                onChange={(e) => setSettings({ ...settings, backup_tg_chat_id: e.target.value })}
                            />
                        </div>
                    )}

                    <div className="form-group checkbox-group" style={{ marginTop: '15px' }}>
                        <label>
                            <input
                                type="checkbox"
                                checked={settings.backup_webdav_enabled === '1'}
                                onChange={(e) => setSettings({ ...settings, backup_webdav_enabled: e.target.checked ? '1' : '0' })}
                            />
                            推送到 WebDAV (坚果云 / Nextcloud 等)
                        </label>
                    </div>

                    {settings.backup_webdav_enabled === '1' && (
                        <>
                            <div className="form-group">
                                <label>WebDAV URL 目录 (例如 https://dav.jianguoyun.com/dav/Backup/)</label>
                                <input
                                    type="text"
                                    value={settings.backup_webdav_url || ''}
                                    onChange={(e) => setSettings({ ...settings, backup_webdav_url: e.target.value })}
                                />
                            </div>
                            <div className="form-group" style={{ display: 'flex', gap: '10px' }}>
                                <div style={{ flex: 1 }}>
                                    <label>WebDAV 用户名</label>
                                    <input
                                        type="text"
                                        value={settings.backup_webdav_user || ''}
                                        onChange={(e) => setSettings({ ...settings, backup_webdav_user: e.target.value })}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label>WebDAV 密码/应用密码</label>
                                    <input
                                        type="password"
                                        value={settings.backup_webdav_password || ''}
                                        onChange={(e) => setSettings({ ...settings, backup_webdav_password: e.target.value })}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {message && <div className="message info">{message}</div>}

                <div className="modal-actions" style={{ marginTop: '20px' }}>
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving || triggering}>取消</button>
                    <button className="btn btn-secondary" onClick={handleTrigger} disabled={saving || triggering}>
                        {triggering ? '推送中...' : '立即测试推送'}
                    </button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving || triggering}>
                        {saving ? '保存中...' : '保存自动备份设置'}
                    </button>
                </div>
            </div>
        </div>
    )
}

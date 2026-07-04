import { useState, useEffect, useRef } from 'react'
import { getBackupSettings, saveBackupSettings, triggerBackup, restoreBackup, downloadAPI } from '../lib/api'

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
    const [confirmFile, setConfirmFile] = useState<File | null>(null)
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

    function handleRestore(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return

        setConfirmFile(file)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    async function executeRestore() {
        if (!confirmFile) return
        setSaving(true)
        setMessage('正在上传并恢复，请不要关闭页面...')
        try {
            const result = await restoreBackup(confirmFile)
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
        setConfirmFile(null)
    }

    async function handleDownload() {
        setMessage('正在准备下载...')
        try {
            const blob = await downloadAPI('/api/backup/download')
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `monitora_backup_${new Date().toISOString().split('T')[0]}.sqlite`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
            setMessage('下载成功')
            setTimeout(() => setMessage(''), 3000)
        } catch (error: any) {
            setMessage('下载失败: ' + error.message)
        }
    }

    if (loading) {
        return (
            <div className="modal-content settings-modal">
                <p>加载中...</p>
            </div>
        )
    }

    return (
        <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
                <h3>备份与恢复</h3>

                <div className="settings-section">
                    <h4>📥 手动操作</h4>
                    <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                        <button onClick={handleDownload} className="btn-primary" style={{ padding: '10px 16px', borderRadius: '8px', fontSize: '0.875rem', display: 'flex', alignItems: 'center' }}>
                            💾 下载当前数据库
                        </button>
                        <button className="btn-secondary" onClick={() => fileInputRef.current?.click()} style={{ padding: '10px 16px', borderRadius: '8px', fontSize: '0.875rem', display: 'flex', alignItems: 'center' }}>
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
                    <span className="form-hint" style={{ marginTop: '12px', display: 'block' }}>
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

                    <div style={{ marginTop: '20px', marginBottom: '15px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--color-text)' }}>
                            <input
                                type="checkbox"
                                style={{ width: '18px', height: '18px', margin: 0, padding: 0 }}
                                checked={settings.backup_tg_enabled === '1'}
                                onChange={(e) => setSettings({ ...settings, backup_tg_enabled: e.target.checked ? '1' : '0' })}
                            />
                            <strong>推送到 Telegram</strong> (需在TG设置中配好全局Bot Token)
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

                    <div style={{ marginTop: '20px', marginBottom: '15px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--color-text)' }}>
                            <input
                                type="checkbox"
                                style={{ width: '18px', height: '18px', margin: 0, padding: 0 }}
                                checked={settings.backup_webdav_enabled === '1'}
                                onChange={(e) => setSettings({ ...settings, backup_webdav_enabled: e.target.checked ? '1' : '0' })}
                            />
                            <strong>推送到 WebDAV</strong> (坚果云 / Nextcloud 等)
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

                {confirmFile && (
                    <div className="modal-overlay" style={{ zIndex: 1000, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px' }}>
                        <div className="modal-content" style={{ padding: '24px', maxWidth: '400px', width: '90%', textAlign: 'center', background: 'var(--bg-card)' }}>
                            <div style={{ fontSize: '32px', marginBottom: '16px' }}>⚠️</div>
                            <h3 style={{ marginBottom: '12px', color: 'var(--color-danger)' }}>警告：危险操作</h3>
                            <p style={{ marginBottom: '24px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                                恢复备份将<strong>覆盖当前的数据库</strong>，当前未备份的数据将永久丢失，并且监控系统将会自动重启！<br/><br/>
                                您确定要继续恢复 <strong>{confirmFile.name}</strong> 吗？
                            </p>
                            <div className="modal-actions" style={{ justifyContent: 'center' }}>
                                <button className="btn btn-secondary" onClick={() => setConfirmFile(null)}>取消</button>
                                <button className="btn btn-danger" style={{ background: 'var(--color-danger)' }} onClick={executeRestore}>确认覆盖</button>
                            </div>
                        </div>
                    </div>
                )}
        </div>
    )
}

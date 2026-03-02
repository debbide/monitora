import { useEffect, useState } from 'react'
import { EmailSettings, getEmailSettings, saveEmailSettings } from '../lib/api'

interface EmailCodeSettingsProps {
  onClose: () => void
}

export default function EmailCodeSettings({ onClose }: EmailCodeSettingsProps) {
  const [settings, setSettings] = useState<EmailSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [passwordInput, setPasswordInput] = useState('')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const settingsData = await getEmailSettings()
      setSettings(settingsData)
    } catch (error: any) {
      console.error('加载邮件配置失败:', error)
      setMessage('加载失败: ' + (error.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveSettings() {
    if (!settings) return
    setSaving(true)
    setMessage('')
    try {
      await saveEmailSettings({
        enabled: settings.enabled,
        host: settings.host,
        port: settings.port,
        user: settings.user,
        password: passwordInput ? passwordInput : undefined,
        tls: settings.tls
      })
      setPasswordInput('')
      await loadAll()
      setMessage('Email 设置已保存')
    } catch (error: any) {
      setMessage('保存失败: ' + (error.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }


  if (loading || !settings) {
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
        <h3>邮件验证码设置</h3>
        <span className="form-hint" style={{ display: 'block', marginBottom: '12px' }}>
          验证码规则请在“添加监控”中选择“邮件验证码监控”进行配置。
        </span>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={e => setSettings({ ...settings, enabled: e.target.checked })}
            />
            启用 IMAP 监听
          </label>
        </div>

        <div className="form-group">
          <label>连接状态</label>
          <div className="status-indicator">
            <span className={`status-dot ${settings.connected ? 'online' : 'offline'}`}></span>
            <span>{settings.connected ? '已连接' : '未连接'}</span>
          </div>
          {settings.last_error && (
            <span className="form-hint" style={{ color: 'var(--color-danger)' }}>
              {settings.last_error}
            </span>
          )}
          {settings.last_sync_at && (
            <span className="form-hint">最近同步: {new Date(settings.last_sync_at).toLocaleString()}</span>
          )}
        </div>

        <div className="form-group">
          <label>邮箱账号</label>
          <input
            type="text"
            value={settings.user}
            onChange={e => setSettings({ ...settings, user: e.target.value })}
            placeholder="your@gmail.com"
          />
        </div>

        <div className="form-group">
          <label>App Password</label>
          <input
            type="password"
            value={passwordInput}
            onChange={e => setPasswordInput(e.target.value)}
            placeholder={settings.has_password ? '已配置（留空则不改）' : 'Google App Password'}
          />
          <span className="form-hint">Gmail 需开启 2FA 后生成 App Password</span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>IMAP Host</label>
            <input
              type="text"
              value={settings.host}
              onChange={e => setSettings({ ...settings, host: e.target.value })}
              placeholder="imap.gmail.com"
            />
          </div>
          <div className="form-group">
            <label>端口</label>
            <input
              type="number"
              value={settings.port}
              onChange={e => setSettings({ ...settings, port: parseInt(e.target.value, 10) || 993 })}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.tls}
              onChange={e => setSettings({ ...settings, tls: e.target.checked })}
            />
            使用 TLS
          </label>
        </div>

        {message && (
          <div className={`message ${message.includes('失败') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}

        <div className="form-actions">
          <button className="btn-secondary" onClick={onClose}>
            关闭
          </button>
          <button className="btn-primary" onClick={handleSaveSettings} disabled={saving}>
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}

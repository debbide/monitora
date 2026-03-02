import { useEffect, useState } from 'react'
import { getWebtaskSettings, saveWebtaskSettings, WebtaskSettings } from '../lib/api'

interface WebtaskSettingsProps {
  onClose: () => void
}

export default function WebtaskSettings({ onClose }: WebtaskSettingsProps) {
  const [settings, setSettings] = useState<WebtaskSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)
    try {
      const data = await getWebtaskSettings()
      setSettings(data)
    } catch (error: any) {
      console.error('加载 WebTask 设置失败:', error)
      setMessage('加载失败: ' + (error.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    setMessage('')
    try {
      await saveWebtaskSettings({
        enabled: settings.enabled,
        api_key: apiKey ? apiKey : undefined
      })
      setApiKey('')
      await loadSettings()
      setMessage('WebTask 鉴权设置已保存')
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
        <h3>WebTask 鉴权设置</h3>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={e => setSettings({ ...settings, enabled: e.target.checked })}
            />
            启用 API Key 验证
          </label>
          <span className="form-hint">启用后 /api/webtask/* 与 /api/email-code/* 需要带 X-API-KEY</span>
        </div>

        <div className="form-group">
          <label>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={settings.has_key ? '已配置（留空不修改）' : '设置一个新的 API Key'}
          />
          <span className="form-hint">请与插件端配置保持一致</span>
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
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}

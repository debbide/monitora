import { useEffect, useState } from 'react'
import {
  EmailRule,
  EmailSettings,
  getEmailRules,
  getEmailSettings,
  saveEmailSettings,
  createEmailRule,
  updateEmailRule,
  deleteEmailRule
} from '../lib/api'

interface EmailCodeSettingsProps {
  onClose: () => void
}

type RuleForm = {
  site_key: string
  from_filter: string
  subject_keyword: string
  body_keyword: string
  code_regex: string
  to_email: string
  timeout_seconds: number
  max_age_seconds: number
  enabled: boolean
}

const emptyRuleForm: RuleForm = {
  site_key: '',
  from_filter: '',
  subject_keyword: '',
  body_keyword: '',
  code_regex: '\\b\\d{6}\\b',
  to_email: '',
  timeout_seconds: 120,
  max_age_seconds: 300,
  enabled: true
}

export default function EmailCodeSettings({ onClose }: EmailCodeSettingsProps) {
  const [settings, setSettings] = useState<EmailSettings | null>(null)
  const [rules, setRules] = useState<EmailRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<RuleForm>(emptyRuleForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [passwordInput, setPasswordInput] = useState('')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [settingsData, rulesData] = await Promise.all([
        getEmailSettings(),
        getEmailRules()
      ])
      setSettings(settingsData)
      setRules(rulesData)
    } catch (error: any) {
      console.error('加载邮件配置失败:', error)
      setMessage('加载失败: ' + (error.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setForm(emptyRuleForm)
    setEditingId(null)
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

  async function handleSaveRule() {
    if (!form.site_key || !form.from_filter || !form.code_regex) {
      setMessage('请填写 site_key、发件人过滤和验证码正则')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      if (editingId) {
        await updateEmailRule(editingId, {
          site_key: form.site_key,
          from_filter: form.from_filter,
          subject_keyword: form.subject_keyword || null,
          body_keyword: form.body_keyword || null,
          code_regex: form.code_regex,
          to_email: form.to_email || null,
          timeout_seconds: form.timeout_seconds,
          max_age_seconds: form.max_age_seconds,
          enabled: form.enabled
        })
      } else {
        await createEmailRule({
          site_key: form.site_key,
          from_filter: form.from_filter,
          subject_keyword: form.subject_keyword || null,
          body_keyword: form.body_keyword || null,
          code_regex: form.code_regex,
          to_email: form.to_email || null,
          timeout_seconds: form.timeout_seconds,
          max_age_seconds: form.max_age_seconds,
          enabled: form.enabled
        })
      }
      await loadAll()
      resetForm()
      setMessage('规则已保存')
    } catch (error: any) {
      setMessage('保存失败: ' + (error.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  function handleEditRule(rule: EmailRule) {
    setEditingId(rule.id)
    setForm({
      site_key: rule.site_key,
      from_filter: rule.from_filter,
      subject_keyword: rule.subject_keyword || '',
      body_keyword: rule.body_keyword || '',
      code_regex: rule.code_regex,
      to_email: rule.to_email || '',
      timeout_seconds: rule.timeout_seconds || 120,
      max_age_seconds: rule.max_age_seconds || 300,
      enabled: rule.enabled === 1
    })
  }

  async function handleDeleteRule(rule: EmailRule) {
    if (!confirm(`确认删除规则 ${rule.site_key} ?`)) return
    setSaving(true)
    setMessage('')
    try {
      await deleteEmailRule(rule.id)
      await loadAll()
      resetForm()
      setMessage('规则已删除')
    } catch (error: any) {
      setMessage('删除失败: ' + (error.message || '未知错误'))
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

        <div className="form-section">
          <h4>验证码规则</h4>

          {rules.length === 0 ? (
            <div className="empty-state" style={{ padding: '16px' }}>
              <p>暂无规则</p>
              <p className="empty-hint">添加规则后即可按 site_key 拉取验证码</p>
            </div>
          ) : (
            <div className="rules-table">
              {rules.map(rule => (
                <div key={rule.id} className="rule-row">
                  <div className="rule-main">
                    <div className="rule-title">
                      <strong>{rule.site_key}</strong>
                      <span className={`rule-status ${rule.enabled === 1 ? 'enabled' : 'disabled'}`}>
                        {rule.enabled === 1 ? '启用' : '禁用'}
                      </span>
                    </div>
                    <div className="rule-meta">
                      <span>From: {rule.from_filter}</span>
                      {rule.subject_keyword && <span>Subject: {rule.subject_keyword}</span>}
                      <span>Regex: {rule.code_regex}</span>
                    </div>
                  </div>
                  <div className="rule-actions">
                    <button className="btn-secondary" onClick={() => handleEditRule(rule)}>编辑</button>
                    <button className="btn-danger" onClick={() => handleDeleteRule(rule)}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="form-section" style={{ borderTop: 'none', paddingTop: 0 }}>
            <h4>{editingId ? '编辑规则' : '新增规则'}</h4>
            <div className="form-group">
              <label>site_key</label>
              <input
                type="text"
                value={form.site_key}
                onChange={e => setForm({ ...form, site_key: e.target.value })}
                placeholder="site_a"
              />
            </div>

            <div className="form-group">
              <label>发件人过滤 (from)</label>
              <input
                type="text"
                value={form.from_filter}
                onChange={e => setForm({ ...form, from_filter: e.target.value })}
                placeholder="no-reply@site.com 或 site.com"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>主题关键词</label>
                <input
                  type="text"
                  value={form.subject_keyword}
                  onChange={e => setForm({ ...form, subject_keyword: e.target.value })}
                  placeholder="验证码"
                />
              </div>
              <div className="form-group">
                <label>正文关键词</label>
                <input
                  type="text"
                  value={form.body_keyword}
                  onChange={e => setForm({ ...form, body_keyword: e.target.value })}
                  placeholder="verification"
                />
              </div>
            </div>

            <div className="form-group">
              <label>验证码正则</label>
              <input
                type="text"
                value={form.code_regex}
                onChange={e => setForm({ ...form, code_regex: e.target.value })}
                placeholder="\\b\\d{6}\\b"
              />
              <span className="form-hint">建议使用捕获组，例如: 验证码[:\s]*(\\d{6})</span>
            </div>

            <div className="form-group">
              <label>收件人 (可选)</label>
              <input
                type="text"
                value={form.to_email}
                onChange={e => setForm({ ...form, to_email: e.target.value })}
                placeholder="user+site@gmail.com"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>等待超时 (秒)</label>
                <input
                  type="number"
                  value={form.timeout_seconds}
                  onChange={e =>
                    setForm({ ...form, timeout_seconds: parseInt(e.target.value, 10) || 120 })
                  }
                />
              </div>
              <div className="form-group">
                <label>仅匹配最近 (秒)</label>
                <input
                  type="number"
                  value={form.max_age_seconds}
                  onChange={e =>
                    setForm({ ...form, max_age_seconds: parseInt(e.target.value, 10) || 300 })
                  }
                />
              </div>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={e => setForm({ ...form, enabled: e.target.checked })}
                />
                启用规则
              </label>
            </div>

            <div className="form-actions">
              <button className="btn-secondary" onClick={resetForm} disabled={saving}>
                清空
              </button>
              <button className="btn-primary" onClick={handleSaveRule} disabled={saving}>
                {editingId ? '保存修改' : '新增规则'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

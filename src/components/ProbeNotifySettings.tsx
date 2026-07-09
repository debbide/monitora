import { useState, useEffect } from 'react'
import {
    getKomariNotifySettings, saveKomariNotifySettings, regenerateKomariNotifyToken, KomariNotifySettings,
    getNezhaNotifySettings, saveNezhaNotifySettings, regenerateNezhaNotifyToken, NezhaNotifySettings
} from '../lib/api'

interface ProbeNotifySettingsProps {
    onClose: () => void
    initialTab?: 'komari' | 'nezha'
}

export default function ProbeNotifySettingsComponent({ onClose, initialTab = 'komari' }: ProbeNotifySettingsProps) {
    const [activeTab, setActiveTab] = useState<'komari' | 'nezha'>(initialTab)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Komari Data
    const [komariSettings, setKomariSettings] = useState<KomariNotifySettings>({
        enabled: false,
        chat_id: '',
        webhook_url: '',
        webhook_body: '',
        webhook_token: ''
    })

    // Nezha Data
    const [nezhaSettings, setNezhaSettings] = useState<NezhaNotifySettings>({
        enabled: false,
        chat_id: '',
        webhook_token: ''
    })

    useEffect(() => {
        loadAllSettings()
    }, [])

    async function loadAllSettings() {
        try {
            const [komari, nezha] = await Promise.all([
                getKomariNotifySettings(),
                getNezhaNotifySettings()
            ])
            setKomariSettings(komari)
            setNezhaSettings(nezha)
        } catch (error) {
            console.error('加载配置失败:', error)
        } finally {
            setLoading(false)
        }
    }

    async function handleSave() {
        setSaving(true)
        try {
            const [res1, res2] = await Promise.all([
                saveKomariNotifySettings(komariSettings),
                saveNezhaNotifySettings(nezhaSettings)
            ])

            if (res1.success && res2.success) {
                alert('✅ 所有配置已保存')
            } else {
                alert(`⚠️ 保存可能不完整: Komari=${res1.success}, Nezha=${res2.success}`)
            }
        } catch (error: any) {
            alert('❌ 保存失败: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    function copyText(text: string) {
        navigator.clipboard.writeText(text)
        alert('已复制到剪贴板')
    }

    async function handleRegenerateKomariToken() {
        if (!confirm('重新生成 Token 会让旧的 Komari Webhook URL 立即失效，需要同步更新 Komari 配置。确定继续？')) return
        const result = await regenerateKomariNotifyToken()
        setKomariSettings({ ...komariSettings, webhook_token: result.webhook_token })
        alert('✅ Komari Token 已重新生成')
    }

    async function handleRegenerateNezhaToken() {
        if (!confirm('重新生成 Token 会让旧的哪吒 Webhook URL 立即失效，需要同步更新哪吒配置。确定继续？')) return
        const result = await regenerateNezhaNotifyToken()
        setNezhaSettings({ ...nezhaSettings, webhook_token: result.webhook_token })
        alert('✅ 哪吒 Token 已重新生成')
    }

    const origin = `${window.location.protocol}//${window.location.host}`
    const komariNotifyUrl = `${origin}/api/komari-notify?token=${encodeURIComponent(komariSettings.webhook_token)}`
    const komariRelayUrl = `${origin}/api/webhook/komari?token=${encodeURIComponent(komariSettings.webhook_token)}`
    const nezhaNotifyUrl = `${origin}/api/nezha-notify-v1?token=${encodeURIComponent(nezhaSettings.webhook_token)}`

    if (loading) {
        return (
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                        <h3>探针通知设置</h3>
                        <button className="modal-close" onClick={onClose}>×</button>
                    </div>
                    <div className="modal-body">
                        <p>加载中...</p>
                    </div>
            </div>
        )
    }

    return (
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
                <h3>📡 探针通知设置</h3>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>

                <div className="tabs" style={{ padding: '0 24px', borderBottom: '1px solid var(--color-border)' }}>
                    <button
                        className={`tab-btn ${activeTab === 'komari' ? 'active' : ''}`}
                        onClick={() => setActiveTab('komari')}
                        style={{
                            padding: '12px 16px',
                            background: 'none',
                            border: 'none',
                            borderBottom: activeTab === 'komari' ? '2px solid var(--color-primary)' : '2px solid transparent',
                            color: activeTab === 'komari' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            fontWeight: activeTab === 'komari' ? 600 : 400,
                            cursor: 'pointer'
                        }}
                    >
                        Komari 面板
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'nezha' ? 'active' : ''}`}
                        onClick={() => setActiveTab('nezha')}
                        style={{
                            padding: '12px 16px',
                            background: 'none',
                            border: 'none',
                            borderBottom: activeTab === 'nezha' ? '2px solid var(--color-primary)' : '2px solid transparent',
                            color: activeTab === 'nezha' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            fontWeight: activeTab === 'nezha' ? 600 : 400,
                            cursor: 'pointer'
                        }}
                    >
                        哪吒探针 (Nezha)
                    </button>
                </div>

                <div className="modal-body">
                    {activeTab === 'komari' && (
                        <div className="tab-pane">
                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="checkbox"
                                        checked={komariSettings.enabled}
                                        onChange={(e) => setKomariSettings({ ...komariSettings, enabled: e.target.checked })}
                                    />
                                    <strong>启用 Komari 通知接收</strong>
                                </label>
                                <span className="form-hint" style={{ display: 'block', marginTop: '4px' }}>
                                    接收 Komari 面板发送的 Webhook 通知
                                </span>
                            </div>

                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label htmlFor="komariChatId">TG 通知群组 ID</label>
                                <input
                                    id="komariChatId"
                                    type="text"
                                    value={komariSettings.chat_id}
                                    onChange={(e) => setKomariSettings({ ...komariSettings, chat_id: e.target.value })}
                                    placeholder="例如: -1001234567890"
                                />
                                <span className="form-hint">
                                    收到通知后发送消息到此 TG 群组（需先在顶栏 🤖 配置 Bot Token）
                                </span>
                            </div>

                            <div className="form-group" style={{ marginTop: '20px', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                <strong>📋 配置说明：</strong>
                                <ol style={{ margin: '8px 0 0 20px', lineHeight: '1.8', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                                    <li>
                                        在 Komari 面板设置 Webhook URL：<br />
                                        <code style={{ background: 'var(--color-surface-hover)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--color-border)', display: 'inline-block', marginTop: '4px', wordBreak: 'break-all' }}>{komariNotifyUrl}</code>
                                        <button type="button" className="btn-text" onClick={() => copyText(komariNotifyUrl)} style={{ marginLeft: '8px' }}>复制</button>
                                    </li>
                                    <li>
                                        Komari TG 中转服务 URL：<br />
                                        <code style={{ background: 'var(--color-surface-hover)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--color-border)', display: 'inline-block', marginTop: '4px', wordBreak: 'break-all' }}>{komariRelayUrl}</code>
                                        <button type="button" className="btn-text" onClick={() => copyText(komariRelayUrl)} style={{ marginLeft: '8px' }}>复制</button>
                                    </li>
                                    <li>在下方添加 <strong>Komari 类型监控</strong>，填写"监控目标服务器"和"Webhook 配置"</li>
                                </ol>
                                <button type="button" className="btn-secondary" onClick={handleRegenerateKomariToken} style={{ marginTop: '12px' }}>
                                    重新生成 Komari Token
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'nezha' && (
                        <div className="tab-pane">
                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="checkbox"
                                        checked={nezhaSettings.enabled}
                                        onChange={(e) => setNezhaSettings({ ...nezhaSettings, enabled: e.target.checked })}
                                    />
                                    <strong>启用哪吒 (Nezha) 通知接收</strong>
                                </label>
                                <span className="form-hint" style={{ display: 'block', marginTop: '4px' }}>
                                    接收 哪吒探针 发送的 Webhook 通知 (仅支持 JSON 格式)
                                </span>
                            </div>

                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label htmlFor="nezhaChatId">TG 通知群组 ID</label>
                                <input
                                    id="nezhaChatId"
                                    type="text"
                                    value={nezhaSettings.chat_id}
                                    onChange={(e) => setNezhaSettings({ ...nezhaSettings, chat_id: e.target.value })}
                                    placeholder="例如: -1001234567890"
                                />
                                <span className="form-hint">
                                    收到哪吒通知后，会转发到此群组
                                </span>
                            </div>

                            <div className="form-group" style={{ marginTop: '20px', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                <strong>📋 配置说明：</strong>
                                <ol style={{ margin: '8px 0 0 20px', lineHeight: '1.8', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                                    <li>在哪吒面板设置中找到 <strong>报警通知 (Nezha)</strong></li>
                                    <li>添加通知方式: <strong>Webhook</strong></li>
                                    <li>
                                        URL 填写: <br />
                                        <code style={{ background: 'var(--color-surface-hover)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--color-border)', display: 'inline-block', marginTop: '4px', wordBreak: 'break-all' }}>{nezhaNotifyUrl}</code>
                                        <button type="button" className="btn-text" onClick={() => copyText(nezhaNotifyUrl)} style={{ marginLeft: '8px' }}>复制</button>
                                    </li>
                                    <li>Request Body 保持默认 JSON 格式即可</li>
                                </ol>
                                <button type="button" className="btn-secondary" onClick={handleRegenerateNezhaToken} style={{ marginTop: '12px' }}>
                                    重新生成哪吒 Token
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onClose}>关闭</button>
                    <button className="btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? '保存所有配置' : '保存所有配置'}
                    </button>
                </div>
        </div>
    )
}

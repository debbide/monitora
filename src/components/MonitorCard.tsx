import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import {
  Monitor,
  MonitorCheck,
  KomariServer,
  deleteMonitor,
  testWebhook,
  checkNow,
  getKomariStatus
} from '../lib/api'
import { RefreshCw, Edit2, Trash2, Loader2, Link } from 'lucide-react'

// 从国旗 emoji 提取国家代码
function extractCountryCode(region: string): string {
  // 检查是否是国旗 emoji (由两个 regional indicator symbols 组成)
  const match = region.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)
  if (match) {
    const flag = match[0]
    // 将 regional indicator 转换为字母
    const chars = [...flag]
    const code = chars.map(c => String.fromCharCode(c.codePointAt(0)! - 0x1f1e6 + 65)).join('')
    return code.toLowerCase()
  }
  // 如果是普通国家代码
  return region.toLowerCase().trim()
}

// 获取国旗图片 URL
function getFlagUrl(region: string): string {
  const code = extractCountryCode(region)
  return `https://flagcdn.com/24x18/${code}.png`
}

interface MonitorCardProps {
  monitor: Monitor & { latestCheck?: MonitorCheck; recentChecks?: MonitorCheck[]; uptime?: number }
  onUpdate: () => void
  onEdit: () => void
}

export default function MonitorCard({ monitor, onUpdate, onEdit }: MonitorCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [komariServers, setKomariServers] = useState<KomariServer[]>([])
  const [isLoadingServers, setIsLoadingServers] = useState(false)

  // 对于 Komari 监控，使用实时服务器状态来判断
  const komariRealTimeStatus =
    monitor.check_type === 'komari' && komariServers.length > 0
      ? komariServers.every(s => s.is_online)
        ? 'up'
        : 'down'
      : null

  const isEmailCode = monitor.check_type === 'email_code'
  // 优先使用 Komari 实时状态，否则使用 latestCheck
  const status = isEmailCode ? 'unknown' : komariRealTimeStatus || monitor.latestCheck?.status || 'unknown'
  const statusColor = status === 'up' ? '#10b981' : status === 'down' ? '#ef4444' : '#6b7280'
  const statusText =
    status === 'up' ? '正常' : status === 'down' ? '故障' : isEmailCode ? '按需' : '未知'
  const displayUrl = isEmailCode
    ? monitor.email_site_key
      ? `site_key: ${monitor.email_site_key}`
      : ''
    : monitor.url || monitor.webhook_url || ''
  const hideNextCheck =
    monitor.check_type === 'telegram' ||
    monitor.check_type === 'komari_webhook' ||
    monitor.check_type === 'nezha_webhook'
  const modeLabelMap: Record<string, string> = {
    http: 'HTTP',
    tcp: 'TCP',
    komari_webhook: 'KOMARI-WH',
    nezha_webhook: 'NEZHA-WH',
    telegram: 'TG',
    scheduled_webhook: 'CRON',
    feedback_linkage: 'FB-LINK',
    email_code: 'EMAIL'
  }
  const modeLabel = modeLabelMap[monitor.check_type]

  // 准备图表数据
  const chartData =
    monitor.recentChecks?.map(check => ({
      time: new Date(check.checked_at).toLocaleTimeString(),
      value: check.response_time
    })) || []

  useEffect(() => {
    if (monitor.check_type === 'komari') {
      loadKomariServers()
    }
  }, [monitor.id, monitor.check_type])

  async function loadKomariServers() {
    setIsLoadingServers(true)
    try {
      const result = await getKomariStatus(monitor.id)
      setKomariServers(result.servers)
    } catch (error) {
      console.error('Failed to load Komari servers:', error)
    } finally {
      setIsLoadingServers(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`确定要删除监控 "${monitor.name}" 吗？`)) return

    setIsDeleting(true)
    try {
      await deleteMonitor(monitor.id)
      toast.success('删除成功')
      onUpdate()
    } catch (error) {
      console.error('Error deleting monitor:', error)
      toast.error('删除失败')
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleTestWebhook() {
    if (!monitor.webhook_url) {
      toast.error('此监控未配置Webhook')
      return
    }

    setIsTesting(true)
    try {
      const result = await testWebhook(monitor.id)

      if (result.success) {
        toast.success('Webhook测试成功！')
      } else {
        toast.error(`Webhook测试失败: ${result.message || '未知错误'}`)
      }
    } catch (err: any) {
      toast.error(`Webhook测试失败: ${err.message || '请稍后重试'}`)
    } finally {
      setIsTesting(false)
    }
  }

  async function handleCheckNow() {
    setIsChecking(true)
    try {
      await checkNow(monitor.id)
      if (monitor.check_type === 'komari') {
        await loadKomariServers()
      }
      toast.success('检查已完成')
      onUpdate()
    } catch (err: any) {
      toast.error(`检查失败: ${err.message || '请稍后重试'}`)
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <div className="monitor-card">
      <div className="monitor-header">
        <div className="monitor-status" style={{ backgroundColor: statusColor }}>
          <span className="status-dot"></span>
          {statusText}
        </div>
        <div className="monitor-actions">

          <button
            className="btn-icon"
            onClick={handleCheckNow}
            disabled={isChecking}
            title="立即检查"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {isChecking ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={16} />}
          </button>
          <button className="btn-icon" onClick={onEdit} title="编辑" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Edit2 size={16} />
          </button>
          <button className="btn-icon" onClick={handleDelete} disabled={isDeleting} title="删除" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isDeleting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={16} />}
          </button>
        </div>
      </div>

      <div className="monitor-title-row">
        <h3 className="monitor-name">{monitor.name}</h3>
        {modeLabel && (
          <span className={`mode-badge mode-${monitor.check_type}`} title={`模式: ${modeLabel}`}>
            {modeLabel}
          </span>
        )}
      </div>
      {displayUrl && (
        isEmailCode ? (
          <span className="monitor-url">{displayUrl}</span>
        ) : (
          <a href={displayUrl} target="_blank" rel="noopener noreferrer" className="monitor-url">
            {displayUrl}
          </a>
        )
      )}

      {!isEmailCode && (
        <div className="monitor-stats">
          <div className="stat">
            <span className="stat-label">可用率</span>
            <span className="stat-value">{monitor.uptime?.toFixed(1) || 0}%</span>
          </div>
          <div className="stat">
            <span className="stat-label">响应时间</span>
            <span
              className="stat-value"
              style={{
                color: (monitor.latestCheck?.response_time || 0) > 1000 ? '#f59e0b' : 'inherit'
              }}
            >
              {monitor.latestCheck?.response_time || 0}ms
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">状态码</span>
            <span
              className="stat-value"
              style={{
                color:
                  monitor.latestCheck?.status_code && monitor.latestCheck.status_code >= 400
                    ? '#ef4444'
                    : 'inherit'
              }}
            >
              {monitor.latestCheck?.status_code || '-'}
            </span>
          </div>
        </div>
      )}

      {/* Sparkline Chart */}
      {!isEmailCode && chartData.length > 1 && (
        <div className="monitor-chart" style={{ height: 60, marginTop: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={`gradient-${monitor.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{
                  background: 'rgba(0,0,0,0.8)',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#fff'
                }}
                itemStyle={{ color: '#fff' }}
                labelStyle={{ display: 'none' }}
                formatter={(value: number) => [`${value}ms`, '响应时间']}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#6366f1"
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#gradient-${monitor.id})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {monitor.check_type === 'komari' && (
        <div className="komari-servers">
          <div className="komari-servers-header">
            <span className="komari-servers-title">服务器状态</span>
            <button
              className="btn-refresh-servers"
              onClick={loadKomariServers}
              disabled={isLoadingServers}
              title="刷新服务器状态"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
            >
              {isLoadingServers ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
            </button>
          </div>
          {isLoadingServers ? (
            <div className="komari-loading">加载中...</div>
          ) : komariServers.length > 0 ? (
            <div className="komari-server-list">
              {komariServers.map((server, index) => (
                <div
                  key={index}
                  className={`komari-server-item ${server.is_online ? 'online' : 'offline'}`}
                >
                  <span className="server-indicator"></span>
                  <img
                    src={getFlagUrl(server.region)}
                    alt={server.region}
                    className="server-flag"
                    onError={e => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                  <span className="server-name">{server.name}</span>
                  <span className="server-time">{server.minutes_ago}分钟前</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="komari-no-servers">无服务器数据</div>
          )}
        </div>
      )}

      {monitor.latestCheck && !isEmailCode && (
        <div className="monitor-footer">
          <span className="last-check">
            最后检查: {new Date(monitor.latestCheck.checked_at).toLocaleString('zh-CN')}
          </span>
          {monitor.next_check_at && !hideNextCheck && (
            <span
              className="next-check"
              style={{ display: 'block', marginTop: '4px', fontSize: '0.9em', color: '#888' }}
            >
              下次执行: {new Date(monitor.next_check_at).toLocaleString('zh-CN')}
            </span>
          )}
          {monitor.next_check_at && hideNextCheck && (
            <span
              className="next-check"
              style={{
                display: 'block',
                marginTop: '4px',
                fontSize: '0.9em',
                color: '#888',
                visibility: 'hidden'
              }}
            >
              占位
            </span>
          )}
        </div>
      )}

      {monitor.latestCheck?.error_message && status === 'down' && !isEmailCode && (
        <div className="monitor-error">错误: {monitor.latestCheck.error_message}</div>
      )}

      {!isEmailCode && (
        <div className="monitor-webhook-test">
          <button
            className="btn-test-webhook"
            onClick={handleTestWebhook}
            disabled={isTesting || !monitor.webhook_url}
            title={!monitor.webhook_url ? '未配置Webhook' : '发送测试通知'}
          >
            {isTesting ? '测试中...' : '测试Webhook'}
          </button>
        </div>
      )}
    </div>
  )
}

import { MonitorWithStatus } from '../App'
import { Activity, CheckCircle, AlertTriangle, Zap, TrendingUp } from 'lucide-react'
interface DashboardStatsProps {
    monitors: MonitorWithStatus[]
}

export default function DashboardStats({ monitors }: DashboardStatsProps) {
    const total = monitors.length
    const up = monitors.filter(m => {
        const status = m.latestCheck?.status
        return status === 'up' || (m.check_type === 'komari' && status !== 'down')
    }).length
    const down = monitors.filter(m => m.latestCheck?.status === 'down').length

    // 计算平均响应时间 (只计算有数据的)
    const responseTimes = monitors
        .map(m => m.latestCheck?.response_time)
        .filter((t): t is number => typeof t === 'number' && t > 0)

    const avgResponseTime = responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : 0

    // 计算平均可用率
    const uptimes = monitors
        .map(m => m.uptime)
        .filter((u): u is number => typeof u === 'number')

    const avgUptime = uptimes.length > 0
        ? (uptimes.reduce((a, b) => a + b, 0) / uptimes.length).toFixed(1)
        : '0.0'

    if (total === 0) return null

    return (
        <div className="dashboard-stats">
            <div className="stat-card">
                <div className="stat-icon total"><Activity size={24} color="#a5b4fc" /></div>
                <div className="stat-info">
                    <span className="stat-value" style={{ textShadow: '0 0 10px rgba(165, 180, 252, 0.4)' }}>{total}</span>
                    <span className="stat-label">总监控</span>
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-icon up"><CheckCircle size={24} color="#34d399" /></div>
                <div className="stat-info">
                    <span className="stat-value success" style={{ textShadow: '0 0 10px rgba(52, 211, 153, 0.4)' }}>{up}</span>
                    <span className="stat-label">运行正常</span>
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-icon down"><AlertTriangle size={24} color="#f87171" /></div>
                <div className="stat-info">
                    <span className="stat-value danger" style={{ textShadow: '0 0 10px rgba(248, 113, 113, 0.4)' }}>{down}</span>
                    <span className="stat-label">服务故障</span>
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-icon time"><Zap size={24} color="#fbbf24" /></div>
                <div className="stat-info">
                    <span className="stat-value" style={{ textShadow: '0 0 10px rgba(251, 191, 36, 0.4)' }}>{avgResponseTime}<small>ms</small></span>
                    <span className="stat-label">平均响应</span>
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-icon uptime"><TrendingUp size={24} color="#38bdf8" /></div>
                <div className="stat-info">
                    <span className="stat-value" style={{ textShadow: '0 0 10px rgba(56, 189, 248, 0.4)' }}>{avgUptime}<small>%</small></span>
                    <span className="stat-label">平均可用率</span>
                </div>
            </div>
        </div>
    )
}

import { useEffect, useState, useRef } from 'react'
import { Toaster, toast } from 'react-hot-toast'
import { Monitor, MonitorCheck, getMonitors, getChecks, getStats, reorderMonitors } from './lib/api'
import MonitorCard from './components/MonitorCard'
import AddMonitorForm from './components/AddMonitorForm'
import LoginForm from './components/LoginForm'
import ChangePasswordModal from './components/ChangePasswordModal'
import DashboardStats from './components/DashboardStats'
import TelegramSettings from './components/TelegramSettings'
import ProbeNotifySettings from './components/ProbeNotifySettings'
import WebtaskSettings from './components/WebtaskSettings'
import BackupSettings from './components/BackupSettings'
import { verifyPassword, setAuthToken, generateAuthToken, isAuthenticated, clearAuthToken } from './lib/auth'
import { Bot, Radio, Key, Save, Sun, Moon, Plus, LogOut, KeyRound } from 'lucide-react'
import './App.css'

export interface MonitorWithStatus extends Monitor {
  latestCheck?: MonitorCheck
  recentChecks?: MonitorCheck[]
  uptime?: number
}

function App() {
  const [monitors, setMonitors] = useState<MonitorWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showTelegramSettings, setShowTelegramSettings] = useState(false)
  const [showProbeSettings, setShowProbeSettings] = useState(false)
  const [showWebtaskSettings, setShowWebtaskSettings] = useState(false)
  const [showBackupSettings, setShowBackupSettings] = useState(false)
  const [editingMonitor, setEditingMonitor] = useState<Monitor | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme')
    return (saved as 'light' | 'dark') || 'light'
  })

  // 拖拽排序相关状态
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragCounter = useRef(0)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  useEffect(() => {
    if (isAuthenticated()) {
      setAuthenticated(true)
      setLoading(false)
    } else {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authenticated) {
      loadMonitors()
      const interval = setInterval(loadMonitors, 30000)
      return () => clearInterval(interval)
    }
  }, [authenticated])

  async function handleLogin(password: string): Promise<boolean> {
    const valid = await verifyPassword(password)
    if (valid) {
      const token = generateAuthToken()
      setAuthToken(token)
      setAuthenticated(true)
      toast.success('欢迎回来！')
    } else {
      toast.error('密码错误')
    }
    return valid
  }

  function handleLogout() {
    clearAuthToken()
    setAuthenticated(false)
    setMonitors([])
    toast.success('已退出登录')
  }

  async function loadMonitors() {
    try {
      const monitorsData = await getMonitors()

      const monitorsWithStatus = await Promise.all(
        monitorsData.map(async (monitor) => {
          try {
            const checks = await getChecks(monitor.id)
            const stats = await getStats(monitor.id)

            const latestCheck = checks.length > 0 ? checks[0] : undefined
            // 获取最近20条记录并反转（用于图表从左到右显示）
            const recentChecks = checks.slice(0, 20).reverse()

            return {
              ...monitor,
              latestCheck,
              recentChecks,
              uptime: stats.uptime_percentage
            }
          } catch (error) {
            console.error(`Error loading data for monitor ${monitor.id}:`, error)
            return {
              ...monitor,
              latestCheck: undefined,
              recentChecks: [],
              uptime: 0
            }
          }
        })
      )

      setMonitors(monitorsWithStatus)
    } catch (error) {
      console.error('Error loading monitors:', error)
      toast.error('加载监控数据失败')
    }
  }

  function handleEdit(monitor: Monitor) {
    setEditingMonitor(monitor)
    setShowAddForm(true)
  }

  function handleCancelEdit() {
    setEditingMonitor(null)
    setShowAddForm(false)
  }

  // 拖拽排序处理函数
  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  function handleDragEnd() {
    setDraggedId(null)
    setDragOverId(null)
    dragCounter.current = 0
  }

  function handleDragEnter(e: React.DragEvent, id: string) {
    e.preventDefault()
    dragCounter.current++
    if (id !== draggedId) {
      setDragOverId(id)
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setDragOverId(null)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    setDragOverId(null)
    dragCounter.current = 0

    if (!draggedId || draggedId === targetId) return

    const draggedIndex = monitors.findIndex(m => m.id === draggedId)
    const targetIndex = monitors.findIndex(m => m.id === targetId)

    if (draggedIndex === -1 || targetIndex === -1) return

    // 重新排序
    const newMonitors = [...monitors]
    const [draggedItem] = newMonitors.splice(draggedIndex, 1)
    newMonitors.splice(targetIndex, 0, draggedItem)

    // 更新本地状态
    setMonitors(newMonitors)
    setDraggedId(null)

    // 保存到服务器
    try {
      const orders = newMonitors.map((m, index) => ({
        id: m.id,
        sort_order: index
      }))
      await reorderMonitors(orders)
    } catch (error) {
      console.error('Error saving order:', error)
      toast.error('保存排序失败')
      loadMonitors() // 失败时重新加载
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    )
  }

  if (!authenticated) {
    return <LoginForm onLogin={handleLogin} />
  }

  return (
    <div className="app">
      <Toaster position="top-right" />
      <header className="header">
        <div className="header-content">
          <div>
            <h1 className="header-title">CloudEye</h1>
            <p className="header-subtitle">服务状态监控</p>
          </div>
          <div className="header-actions">
            <button
              className="btn-add-monitor"
              onClick={() => {
                if (showAddForm) {
                  handleCancelEdit()
                } else {
                  setShowAddForm(true)
                }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {showAddForm ? '取消' : <><Plus size={16} /> 添加监控</>}
            </button>
            <button className="btn-theme" onClick={toggleTheme} title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', padding: 0 }}>
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button className="btn-change-password" onClick={() => setShowChangePassword(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <KeyRound size={16} /> 修改密码
            </button>
            <button className="btn-logout" onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <LogOut size={16} /> 退出登录
            </button>
            <button className="btn-telegram" onClick={() => setShowTelegramSettings(true)} title="Telegram Bot 设置" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', padding: 0 }}>
              <Bot size={18} />
            </button>
            <button className="btn-telegram" onClick={() => setShowProbeSettings(true)} title="探针通知设置 (Komari/Nezha)" style={{ marginLeft: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', padding: 0 }}>
              <Radio size={18} />
            </button>
            <button className="btn-telegram" onClick={() => setShowWebtaskSettings(true)} title="WebTask 鉴权设置" style={{ marginLeft: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', padding: 0 }}>
              <Key size={18} />
            </button>
            <button className="btn-telegram" onClick={() => setShowBackupSettings(true)} title="备份与恢复设置" style={{ marginLeft: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', padding: 0 }}>
              <Save size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <DashboardStats monitors={monitors} />
        {monitors.length === 0 ? (
          <div className="empty-state">
            <p>暂无监控任务</p>
            <p className="empty-hint">点击上方按钮添加第一个监控</p>
          </div>
        ) : (
          <div className="monitors-grid">
            {monitors.map(monitor => (
              <div
                key={monitor.id}
                draggable
                onDragStart={(e) => handleDragStart(e, monitor.id)}
                onDragEnd={handleDragEnd}
                onDragEnter={(e) => handleDragEnter(e, monitor.id)}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, monitor.id)}
                className={`monitor-drag-wrapper ${draggedId === monitor.id ? 'dragging' : ''} ${dragOverId === monitor.id ? 'drag-over' : ''}`}
              >
                <MonitorCard
                  monitor={monitor}
                  onUpdate={loadMonitors}
                  onEdit={() => handleEdit(monitor)}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Docker 部署版 | Express + SQLite</p>
      </footer>

      {showChangePassword && (
        <ChangePasswordModal
          onClose={() => setShowChangePassword(false)}
          onSuccess={() => {
            toast.success('密码修改成功！请使用新密码重新登录。')
            handleLogout()
          }}
        />
      )}

      {showTelegramSettings && (
        <TelegramSettings onClose={() => setShowTelegramSettings(false)} />
      )}

      {showProbeSettings && (
        <ProbeNotifySettings onClose={() => setShowProbeSettings(false)} />
      )}

      {showWebtaskSettings && (
        <WebtaskSettings onClose={() => setShowWebtaskSettings(false)} />
      )}

      {showBackupSettings && (
        <BackupSettings onClose={() => setShowBackupSettings(false)} />
      )}

      {showAddForm && (
        <div className="modal-overlay" onClick={handleCancelEdit}>
          <div className="modal-content modal-form" onClick={e => e.stopPropagation()}>
            <AddMonitorForm
              editMonitor={editingMonitor}
              onSuccess={() => {
                toast.success(editingMonitor ? '修改成功' : '添加成功')
                handleCancelEdit()
                loadMonitors()
              }}
              onCancel={handleCancelEdit}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default App

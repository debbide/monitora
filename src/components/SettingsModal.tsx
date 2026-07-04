import { useState } from 'react'
import { X, Shield, Bot, Radio, Key, Save, Settings } from 'lucide-react'
import './SettingsModal.css'

import ChangePasswordModal from './ChangePasswordModal'
import TelegramSettings from './TelegramSettings'
import ProbeNotifySettings from './ProbeNotifySettings'
import WebtaskSettings from './WebtaskSettings'
import BackupSettings from './BackupSettings'

interface SettingsModalProps {
  onClose: () => void
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'password' | 'telegram' | 'probe' | 'webtask' | 'backup'>('telegram')

  const handlePasswordSuccess = () => {
    // When password is changed, log out the user
    // We can dispatch a custom event or just reload the page for simplicity
    window.location.reload()
  }

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal-container" onClick={e => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2><Settings size={20} /> 系统设置</h2>
          <button className="settings-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="settings-modal-body">
          <div className="settings-sidebar">
            <div className="settings-nav-group">
              <div className="settings-nav-group-title">通知与集成</div>
              <button 
                className={`settings-nav-item ${activeTab === 'telegram' ? 'active' : ''}`}
                onClick={() => setActiveTab('telegram')}
              >
                <Bot size={18} /> Telegram Bot
              </button>
              <button 
                className={`settings-nav-item ${activeTab === 'probe' ? 'active' : ''}`}
                onClick={() => setActiveTab('probe')}
              >
                <Radio size={18} /> 探针通知 (Komari)
              </button>
            </div>
            
            <div className="settings-nav-group">
              <div className="settings-nav-group-title">系统与数据</div>
              <button 
                className={`settings-nav-item ${activeTab === 'webtask' ? 'active' : ''}`}
                onClick={() => setActiveTab('webtask')}
              >
                <Key size={18} /> WebTask 鉴权
              </button>
              <button 
                className={`settings-nav-item ${activeTab === 'backup' ? 'active' : ''}`}
                onClick={() => setActiveTab('backup')}
              >
                <Save size={18} /> 备份与恢复
              </button>
            </div>
            
            <div className="settings-nav-group">
              <div className="settings-nav-group-title">账户安全</div>
              <button 
                className={`settings-nav-item ${activeTab === 'password' ? 'active' : ''}`}
                onClick={() => setActiveTab('password')}
              >
                <Shield size={18} /> 修改密码
              </button>
            </div>
          </div>
          
          <div className="settings-content-area">
            {activeTab === 'telegram' && <TelegramSettings onClose={onClose} />}
            {activeTab === 'probe' && <ProbeNotifySettings onClose={onClose} />}
            {activeTab === 'webtask' && <WebtaskSettings onClose={onClose} />}
            {activeTab === 'backup' && <BackupSettings onClose={onClose} />}
            {activeTab === 'password' && <ChangePasswordModal onClose={onClose} onSuccess={handlePasswordSuccess} />}
          </div>
        </div>
      </div>
    </div>
  )
}

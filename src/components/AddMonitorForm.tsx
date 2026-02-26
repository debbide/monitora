import { useState, useEffect } from 'react'
import { createMonitor, updateMonitor, Monitor, testTelegramChat } from '../lib/api'

interface AddMonitorFormProps {
  onSuccess: () => void
  onCancel?: () => void
  editMonitor?: Monitor | null
}

export default function AddMonitorForm({ onSuccess, onCancel, editMonitor }: AddMonitorFormProps) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  // Scheduling State
  const [scheduleMode, setScheduleMode] = useState<'fixed' | 'random'>('fixed')

  // Fixed Schedule
  const [schedDays, setSchedDays] = useState('0')
  const [schedHours, setSchedHours] = useState('0')
  const [schedMinutes, setSchedMinutes] = useState('5')

  // Random Schedule
  const [randomMin, setRandomMin] = useState('5')
  const [randomMax, setRandomMax] = useState('10')
  const [randomUnit, setRandomUnit] = useState<'minutes' | 'hours' | 'days'>('minutes')

  const [checkType, setCheckType] = useState<
    | 'http'
    | 'tcp'
    | 'komari'
    | 'komari_webhook'
    | 'nezha_webhook'
    | 'telegram'
    | 'scheduled_webhook'
    | 'feedback_linkage'
  >('http')
  const [checkMethod, setCheckMethod] = useState<'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH'>('GET')
  const [checkTimeout, setCheckTimeout] = useState('30')
  const [expectedStatusCodes, setExpectedStatusCodes] = useState('200,201,204,301,302')
  const [expectedKeyword, setExpectedKeyword] = useState('')
  const [forbiddenKeyword, setForbiddenKeyword] = useState('')
  const [komariOfflineThreshold, setKomariOfflineThreshold] = useState('3')

  // Request Configuration (HTTP & Scheduled Webhook)
  const [checkContentType, setCheckContentType] = useState('application/json')
  const [checkHeaders, setCheckHeaders] = useState('')
  const [checkBody, setCheckBody] = useState('')

  // Telegram 相关状态
  const [tgChatId, setTgChatId] = useState('')
  const [tgServerName, setTgServerName] = useState('')
  const [tgOfflineKeywords, setTgOfflineKeywords] = useState('离线,offline,down,掉线')
  const [tgOnlineKeywords, setTgOnlineKeywords] = useState('上线,online,up,恢复')
  const [tgNotifyChatId, setTgNotifyChatId] = useState('') // Komari & Scheduled Webhook 用的 TG 通知群组
  const [webhookUrl, setWebhookUrl] = useState('')
  const [contentType, setContentType] = useState('application/json')
  const [headers, setHeaders] = useState('')
  const [body, setBody] = useState('')
  const [username, setUsername] = useState('')
  const [feedbackLinkage, setFeedbackLinkage] = useState(false)
  const [feedbackThreshold, setFeedbackThreshold] = useState('24')
  const [feedbackFluctuationMin, setFeedbackFluctuationMin] = useState('0')
  const [feedbackFluctuationMax, setFeedbackFluctuationMax] = useState('0')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isEditMode = !!editMonitor

  useEffect(() => {
    if (editMonitor) {
      setName(editMonitor.name)
      setUrl(editMonitor.url)

      // Initialize Scheduling Mode
      if (
        editMonitor.check_interval_max &&
        editMonitor.check_interval_max > editMonitor.check_interval
      ) {
        setScheduleMode('random')
        const min = editMonitor.check_interval
        const max = editMonitor.check_interval_max

        // Heuristic to detect unit
        if (min % 1440 === 0 && max % 1440 === 0) {
          setRandomUnit('days')
          setRandomMin(String(min / 1440))
          setRandomMax(String(max / 1440))
        } else if (min % 60 === 0 && max % 60 === 0) {
          setRandomUnit('hours')
          setRandomMin(String(min / 60))
          setRandomMax(String(max / 60))
        } else {
          setRandomUnit('minutes')
          setRandomMin(String(min))
          setRandomMax(String(max))
        }

        // Also populate fixed fields just in case user switches back
        setSchedDays('0')
        setSchedHours('0')
        setSchedMinutes('5')
      } else {
        setScheduleMode('fixed')
        const totalMinutes = editMonitor.check_interval || 5
        const days = Math.floor(totalMinutes / 1440)
        const hours = Math.floor((totalMinutes % 1440) / 60)
        const minutes = totalMinutes % 60
        setSchedDays(String(days))
        setSchedHours(String(hours))
        setSchedMinutes(String(minutes))

        // Populate random fields with defaults
        setRandomMin('5')
        setRandomMax('10')
        setRandomUnit('minutes')
      }

      setCheckType(editMonitor.check_type || 'http')
      setCheckMethod(editMonitor.check_method || 'GET')
      setCheckTimeout(String(editMonitor.check_timeout || 30))
      setExpectedStatusCodes(editMonitor.expected_status_codes || '200,201,204,301,302')
      setExpectedKeyword(editMonitor.expected_keyword || '')
      setForbiddenKeyword(editMonitor.forbidden_keyword || '')
      setKomariOfflineThreshold(String(editMonitor.komari_offline_threshold || 3))

      setCheckContentType(editMonitor.check_content_type || 'application/json')
      setCheckHeaders(editMonitor.check_headers || '')
      setCheckBody(editMonitor.check_body || '')

      setTgChatId(editMonitor.tg_chat_id || '')
      setTgServerName(editMonitor.tg_server_name || '')
      setTgOfflineKeywords(editMonitor.tg_offline_keywords || '离线,offline,down,掉线')
      setTgOnlineKeywords(editMonitor.tg_online_keywords || '上线,online,up,恢复')
      setTgNotifyChatId(editMonitor.tg_notify_chat_id || '')
      setWebhookUrl(editMonitor.webhook_url || '')
      setContentType(editMonitor.webhook_content_type || 'application/json')
      setHeaders(editMonitor.webhook_headers || '')
      setBody(editMonitor.webhook_body || '')
      setUsername(editMonitor.webhook_username || '')
      setFeedbackLinkage(
        editMonitor.feedback_linkage === 1 || editMonitor.check_type === 'feedback_linkage'
      )
      setFeedbackThreshold(String(editMonitor.feedback_threshold || 24))
      setFeedbackFluctuationMin(String(editMonitor.feedback_fluctuation_min || 0))
      setFeedbackFluctuationMax(String(editMonitor.feedback_fluctuation_max || 0))
    }
  }, [editMonitor])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!name.trim()) {
      alert('请填写监控名称')
      return
    }

    // Telegram, komari_webhook, nezha_webhook 类型不需要 URL，其他类型需要 URL
    if (
      checkType === 'telegram' ||
      checkType === 'komari_webhook' ||
      checkType === 'nezha_webhook'
    ) {
      if (checkType === 'telegram' && !tgChatId.trim()) {
        alert('请填写群组 ID')
        return
      }
      if (checkType === 'komari_webhook' && !expectedKeyword.trim()) {
        alert('请填写监控目标服务器（用于匹配 Komari 通知）')
        return
      }
      if (checkType === 'nezha_webhook' && !expectedKeyword.trim()) {
        alert('请填写 Nezha 监控中的服务器名称')
        return
      }
    } else if (checkType === 'scheduled_webhook') {
      // Scheduled Webhook check
    } else {
      if (!url.trim()) {
        alert('请填写 URL')
        return
      }
    }

    let parsedHeaders = {}
    let parsedBody = {}
    let parsedCheckHeaders = {}
    let parsedCheckBody = {}

    // Parse Webhook Config Headers/Body
    if (headers.trim()) {
      try {
        parsedHeaders = JSON.parse(headers)
      } catch (error) {
        alert('Webhook Headers格式错误，请输入有效的JSON')
        return
      }
    }

    if (body.trim()) {
      try {
        parsedBody = JSON.parse(body)
      } catch (error) {
        alert('Webhook Body格式错误，请输入有效的JSON')
        return
      }
    }

    // Parse Request Config Headers/Body (for HTTP & Scheduled Webhook)
    if (checkHeaders.trim()) {
      try {
        parsedCheckHeaders = JSON.parse(checkHeaders)
      } catch (error) {
        alert('请求 Headers格式错误，请输入有效的JSON')
        return
      }
    }

    if (checkBody.trim()) {
      try {
        parsedCheckBody = JSON.parse(checkBody)
      } catch (error) {
        alert('请求 Body格式错误，请输入有效的JSON')
        return
      }
    }

    setIsSubmitting(true)
    try {
      let finalInterval = 5
      let intervalMaxNum = null

      if (scheduleMode === 'fixed') {
        // Fixed Mode: Calculate total minutes from Days/Hours/Minutes
        const days = parseInt(schedDays) || 0
        const hours = parseInt(schedHours) || 0
        const minutes = parseInt(schedMinutes) || 0
        const totalMinutes = days * 1440 + hours * 60 + minutes
        finalInterval = totalMinutes > 0 ? totalMinutes : 5
        intervalMaxNum = null
      } else {
        // Random Mode: interval is MIN, intervalMax is MAX
        const rMin = parseFloat(randomMin) || 0
        const rMax = parseFloat(randomMax) || 0
        const multiplier = randomUnit === 'days' ? 1440 : randomUnit === 'hours' ? 60 : 1

        const minTime = Math.floor(rMin * multiplier)
        const maxTime = Math.floor(rMax * multiplier)

        finalInterval = minTime > 0 ? minTime : 5
        // Ensure max > min
        if (maxTime > finalInterval) {
          intervalMaxNum = maxTime
        } else {
          // Fallback to fixed if max <= min
          intervalMaxNum = null
        }
      }

      const timeoutNum = parseInt(checkTimeout) || 30
      const thresholdNum = parseInt(komariOfflineThreshold) || 3

      const monitorData = {
        name: name.trim(),
        url: checkType === 'telegram' ? '' : url.trim(),
        check_interval: finalInterval,
        check_interval_max: intervalMaxNum,
        check_type: checkType,
        check_method: checkMethod,
        check_timeout: timeoutNum,
        expected_status_codes: expectedStatusCodes.trim() || '200,201,204,301,302',
        expected_keyword: expectedKeyword.trim() || undefined,
        forbidden_keyword: forbiddenKeyword.trim() || undefined,
        komari_offline_threshold: thresholdNum,
        tg_chat_id: tgChatId.trim() || undefined,
        tg_server_name: tgServerName.trim() || undefined,
        tg_offline_keywords: tgOfflineKeywords.trim() || undefined,
        tg_online_keywords: tgOnlineKeywords.trim() || undefined,
        tg_notify_chat_id: tgNotifyChatId.trim() || undefined,
        webhook_url: webhookUrl.trim() || undefined,
        webhook_content_type: contentType,
        webhook_headers: Object.keys(parsedHeaders).length > 0 ? parsedHeaders : undefined,
        webhook_body: Object.keys(parsedBody).length > 0 ? parsedBody : undefined,
        webhook_username: username.trim() || undefined,
        check_headers: Object.keys(parsedCheckHeaders).length > 0 ? parsedCheckHeaders : undefined,
        check_body: Object.keys(parsedCheckBody).length > 0 ? parsedCheckBody : undefined,
        feedback_linkage: feedbackLinkage || checkType === 'feedback_linkage' ? 1 : 0,
        feedback_threshold: parseInt(feedbackThreshold) || 0,
        feedback_fluctuation_min: parseInt(feedbackFluctuationMin) || 0,
        feedback_fluctuation_max: parseInt(feedbackFluctuationMax) || 0
      } as any

      if (isEditMode && editMonitor) {
        await updateMonitor(editMonitor.id, monitorData)
      } else {
        await createMonitor(monitorData)
        resetForm()
      }

      onSuccess()
    } catch (error: any) {
      console.error('Error saving monitor:', error)
      const errorMsg = error?.message || '未知错误'
      alert(isEditMode ? `保存失败: ${errorMsg}` : `添加失败: ${errorMsg}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  function resetForm() {
    setName('')
    setUrl('')
    setScheduleMode('fixed')
    setSchedDays('0')
    setSchedHours('0')
    setSchedMinutes('5')
    setRandomMin('5')
    setRandomMax('10')
    setRandomUnit('minutes')
    setCheckType('http')
    setCheckMethod('GET')
    setCheckTimeout('30')
    setExpectedStatusCodes('200,201,204,301,302')
    setExpectedKeyword('')
    setForbiddenKeyword('')
    setKomariOfflineThreshold('3')

    setCheckContentType('application/json')
    setCheckHeaders('')
    setCheckBody('')

    setTgChatId('')
    setTgServerName('')
    setTgOfflineKeywords('离线,offline,down,掉线')
    setTgOnlineKeywords('上线,online,up,恢复')
    setTgNotifyChatId('')
    setWebhookUrl('')
    setContentType('application/json')
    setHeaders('')
    setUsername('')
    setFeedbackLinkage(false)
    setFeedbackThreshold('24')
    setFeedbackFluctuationMin('0')
    setFeedbackFluctuationMax('0')
  }

  return (
    <form className="add-monitor-form" onSubmit={handleSubmit}>
      <h3>{isEditMode ? '编辑监控' : '添加新监控'}</h3>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="name">监控名称</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如: 我的网站"
            required
          />
        </div>

        {checkType !== 'telegram' &&
          checkType !== 'komari_webhook' &&
          checkType !== 'nezha_webhook' &&
          checkType !== 'scheduled_webhook' &&
          checkType !== 'feedback_linkage' && (
            <div className="form-group">
              <label htmlFor="url">{checkType === 'komari' ? 'Komari API 地址' : '网站URL'}</label>
              <input
                id="url"
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder={
                  checkType === 'komari'
                    ? 'https://your-komari-domain.com/api/client'
                    : 'https://example.com 或 example.com:8080'
                }
                required
              />
            </div>
          )}
      </div>

      <div className="form-section">
        <h4>检测类型</h4>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="checkType">检测类型</label>
            <select
              id="checkType"
              value={checkType}
              onChange={e => setCheckType(e.target.value as any)}
            >
              <option value="http">HTTP 检测</option>
              <option value="tcp">TCP 连通性检测 (Ping)</option>
              <option value="komari">Komari 轮询监控</option>
              <option value="komari_webhook">Komari Webhook 监控</option>
              <option value="nezha_webhook">哪吒 (Nezha) Webhook 监控</option>
              <option value="telegram">Telegram 群组监控</option>
              <option value="scheduled_webhook">定时触发 (Webhook/Cron)</option>
              <option value="feedback_linkage">反馈联动监控 (Feedback Linkage)</option>
            </select>
          </div>
        </div>
      </div>

      {checkType !== 'telegram' &&
        checkType !== 'komari_webhook' &&
        checkType !== 'nezha_webhook' &&
        checkType !== 'feedback_linkage' && (
          <div className="form-section">
            <h4>检测配置</h4>

            {checkType === 'http' && (
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="checkMethod">请求方法</label>
                  <select
                    id="checkMethod"
                    value={checkMethod}
                    onChange={e => setCheckMethod(e.target.value as 'GET' | 'HEAD' | 'POST')}
                  >
                    <option value="GET">GET</option>
                    <option value="HEAD">HEAD</option>
                    <option value="POST">POST</option>
                  </select>
                </div>
              </div>
            )}

            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label>
                  {checkType === 'scheduled_webhook' ? '触发周期' : '检查间隔'}
                  {(checkType === 'http' || checkType === 'scheduled_webhook') && (
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: 'normal',
                        marginLeft: '8px',
                        color: 'var(--text-secondary)'
                      }}
                    >
                      模式:
                      <select
                        value={scheduleMode}
                        onChange={e => setScheduleMode(e.target.value as 'fixed' | 'random')}
                        style={{
                          marginLeft: '4px',
                          padding: '2px 4px',
                          fontSize: '12px',
                          border: 'none',
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          borderRadius: '4px'
                        }}
                      >
                        <option value="fixed">固定周期</option>
                        <option value="random">随机区间</option>
                      </select>
                    </span>
                  )}
                </label>

                {/* Fixed Mode UI */}
                {scheduleMode === 'fixed' && (
                  <>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <input
                            type="number"
                            min="0"
                            value={schedDays}
                            onChange={e => setSchedDays(e.target.value)}
                            style={{ width: '100%' }}
                          />
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            天
                          </span>
                        </div>
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <input
                            type="number"
                            min="0"
                            max="23"
                            value={schedHours}
                            onChange={e => setSchedHours(e.target.value)}
                            style={{ width: '100%' }}
                          />
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            时
                          </span>
                        </div>
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <input
                            type="number"
                            min="0"
                            max="59"
                            value={schedMinutes}
                            onChange={e => setSchedMinutes(e.target.value)}
                            style={{ width: '100%' }}
                          />
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            分
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className="form-hint">
                      {`固定每 ${parseInt(schedDays) || 0}天 ${parseInt(schedHours) || 0}小时 ${parseInt(schedMinutes) || 0}分 执行一次`}
                    </span>
                  </>
                )}

                {/* Random Mode UI */}
                {scheduleMode === 'random' && (
                  <>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        type="number"
                        value={randomMin}
                        onChange={e => setRandomMin(e.target.value)}
                        style={{ flex: 1 }}
                        placeholder="Min"
                      />
                      <span style={{ fontSize: '14px' }}>至</span>
                      <input
                        type="number"
                        value={randomMax}
                        onChange={e => setRandomMax(e.target.value)}
                        style={{ flex: 1 }}
                        placeholder="Max"
                      />
                      <select
                        value={randomUnit}
                        onChange={e => setRandomUnit(e.target.value as any)}
                        style={{ width: '80px' }}
                      >
                        <option value="minutes">分钟</option>
                        <option value="hours">小时</option>
                        <option value="days">天</option>
                      </select>
                    </div>
                    <span className="form-hint">
                      每次检查将在 {randomMin} - {randomMax}{' '}
                      {randomUnit === 'minutes' ? '分钟' : randomUnit === 'hours' ? '小时' : '天'}{' '}
                      内随机触发
                    </span>
                  </>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="checkTimeout">超时时间（秒）</label>
                <input
                  id="checkTimeout"
                  type="number"
                  min="5"
                  max="120"
                  value={checkTimeout}
                  onChange={e => setCheckTimeout(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

      {checkType === 'feedback_linkage' && (
        <div className="form-section">
          <h4>检测配置</h4>
          <div className="form-group">
            <label htmlFor="checkType">检测类型</label>
            <select
              id="checkType"
              value={checkType}
              onChange={e => setCheckType(e.target.value as any)}
            >
              <option value="http">HTTP 检测</option>
              <option value="tcp">TCP 连通性检测 (Ping)</option>
              <option value="komari">Komari 轮询监控</option>
              <option value="komari_webhook">Komari Webhook 监控</option>
              <option value="nezha_webhook">哪吒 (Nezha) Webhook 监控</option>
              <option value="telegram">Telegram 群组监控</option>
              <option value="scheduled_webhook">定时触发 (Webhook/Cron)</option>
              <option value="feedback_linkage">反馈联动监控 (Feedback Linkage)</option>
            </select>
          </div>

          <div
            className="form-group"
            style={{
              background: 'var(--bg-secondary)',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              marginTop: '16px'
            }}
          >
            <h5 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>
              🔗 联动参数 (Feedback Parameters)
            </h5>

            <div className="form-group">
              <label htmlFor="expectedKeyword">服务器匹配关键词 (用于回调识别)</label>
              <input
                id="expectedKeyword"
                type="text"
                value={expectedKeyword}
                onChange={e => setExpectedKeyword(e.target.value)}
                placeholder="例如: Server-A"
                required
              />
              <span className="form-hint">回调接口会根据此关键词匹配监控项。请确保唯一。</span>
            </div>

            <div className="form-row" style={{ marginTop: '16px' }}>
              <div className="form-group">
                <label htmlFor="feedbackThreshold">续期触发阈值 (小时)</label>
                <input
                  id="feedbackThreshold"
                  type="number"
                  value={feedbackThreshold}
                  onChange={e => setFeedbackThreshold(e.target.value)}
                  placeholder="例如: 24"
                />
                <span className="form-hint">小于此剩余时间进入续期窗口</span>
              </div>
              <div className="form-group">
                <label>执行波动范围 (小时)</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="number"
                    value={feedbackFluctuationMin}
                    onChange={e => setFeedbackFluctuationMin(e.target.value)}
                    style={{ flex: 1 }}
                    placeholder="Min"
                  />
                  <span style={{ fontSize: '14px' }}>至</span>
                  <input
                    type="number"
                    value={feedbackFluctuationMax}
                    onChange={e => setFeedbackFluctuationMax(e.target.value)}
                    style={{ flex: 1 }}
                    placeholder="Max"
                  />
                </div>
                <span className="form-hint">在触发点之前随机减去的延迟量</span>
              </div>
            </div>

            <span
              className="form-hint"
              style={{
                marginTop: '12px',
                display: 'block',
                padding: '10px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)'
              }}
            >
              <strong>逻辑说明：</strong> 实际触发点 = <code>触发阈值 - 随机(波动范围)</code>。
              <br />
              例如配置 24 小时阈值，波动 2-3 小时。面板将在服务器剩余 21~22 小时左右执行续期。
            </span>
          </div>

          <div
            className="form-group"
            style={{
              background: 'var(--bg-secondary)',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              marginTop: '16px'
            }}
          >
            <h5 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>📢 通知配置 (Notification)</h5>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="tgNotifyChatId_fl">Telegram 通知群组 ID</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  id="tgNotifyChatId_fl"
                  type="text"
                  value={tgNotifyChatId}
                  onChange={e => setTgNotifyChatId(e.target.value)}
                  placeholder="例如: -1001234567890"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    if (!tgNotifyChatId.trim()) {
                      alert('请先输入群组 ID')
                      return
                    }
                    try {
                      const result = await testTelegramChat(tgNotifyChatId.trim())
                      alert(result.message)
                    } catch (err: any) {
                      alert('测试失败: ' + err.message)
                    }
                  }}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  📡 测试
                </button>
              </div>
              <span className="form-hint">续期成功或失败时，将通过 Telegram 发送通知到此群组</span>
            </div>
          </div>

          <div
            className="form-group"
            style={{
              background: 'var(--bg-tertiary)',
              padding: '16px',
              borderRadius: '12px',
              marginTop: '16px',
              border: '1px solid var(--border-color)'
            }}
          >
            <h5 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>
              📡 脚本对接指引 (Callback Guide)
            </h5>
            <label>通用回调接口 (通过关键词匹配)</label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--bg-primary)',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                marginBottom: '12px'
              }}
            >
              <code
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--accent-color)',
                  wordBreak: 'break-all'
                }}
              >
                {window.location.protocol}//{window.location.host}/api/callback
              </code>
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  const url = `${window.location.protocol}//${window.location.host}/api/callback`
                  navigator.clipboard.writeText(url)
                  alert('已复制到剪贴板')
                }}
                title="复制链接"
              >
                📋
              </button>
            </div>

            <label>特定监控 ID 接口</label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--bg-primary)',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}
            >
              <code
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--accent-color)',
                  wordBreak: 'break-all'
                }}
              >
                {window.location.protocol}//{window.location.host}/api/callback/
                {editMonitor?.id || 'NEW_ID'}
              </code>
            </div>

            <div className="form-hint" style={{ marginTop: '12px' }}>
              <strong>POST Payload:</strong>
              <br />
              <code style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                {'{'} "server_name": "{expectedKeyword || '你的关键词'}", "remaining_time": 秒,
                "status": "up" {'}'}
              </code>
            </div>
          </div>
        </div>
      )}

      {(checkType === 'http' ||
        checkType === 'scheduled_webhook' ||
        checkType === 'feedback_linkage') && (
        <div className="form-section">
          <h4>Request Configuration</h4>

          {(checkType === 'scheduled_webhook' || checkType === 'feedback_linkage') && (
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="url">触发 URL (Trigger Webhook)</label>
                <input
                  id="url"
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://api.github.com/repos/..."
                  required
                  style={{ width: '100%' }}
                />
                <span className="form-hint">
                  填写需要触发的 Webhook 地址 (如 GitHub Dispatch URL)
                </span>
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="checkContentType">Content-Type</label>
              <input
                id="checkContentType"
                type="text"
                value={checkContentType}
                onChange={e => setCheckContentType(e.target.value)}
                placeholder="application/json"
              />
            </div>

            {(checkType === 'scheduled_webhook' ||
              checkType === 'http' ||
              checkType === 'feedback_linkage') && (
              <div className="form-group">
                <label htmlFor="checkMethod">Request Method</label>
                <select
                  id="checkMethod"
                  value={checkMethod}
                  onChange={e => setCheckMethod(e.target.value as any)}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="HEAD">HEAD</option>
                </select>
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="checkHeaders">Custom Headers (JSON)</label>
            <textarea
              id="checkHeaders"
              value={checkHeaders}
              onChange={e => setCheckHeaders(e.target.value)}
              placeholder='{"Authorization": "Bearer token", "Accept": "application/vnd.github+json"}'
              rows={3}
            />
          </div>

          <div className="form-group">
            <label htmlFor="checkBody">Request Body (JSON)</label>
            <textarea
              id="checkBody"
              value={checkBody}
              onChange={e => setCheckBody(e.target.value)}
              placeholder='{"event_type": "trigger", "client_payload": {}}'
              rows={4}
            />
          </div>

          {checkType === 'http' && (
            <>
              <div className="form-group">
                <label htmlFor="expectedStatusCodes">期望状态码（逗号分隔）</label>
                <input
                  id="expectedStatusCodes"
                  type="text"
                  value={expectedStatusCodes}
                  onChange={e => setExpectedStatusCodes(e.target.value)}
                  placeholder="200,201,204,301,302"
                />
                <span className="form-hint">返回这些状态码视为正常</span>
              </div>

              <div className="form-group">
                <label htmlFor="expectedKeyword">期望关键词（可选）</label>
                <input
                  id="expectedKeyword"
                  type="text"
                  value={expectedKeyword}
                  onChange={e => setExpectedKeyword(e.target.value)}
                  placeholder="例如: success 或 OK"
                />
                <span className="form-hint">响应内容必须包含此关键词才视为正常</span>
              </div>

              <div className="form-group">
                <label htmlFor="forbiddenKeyword">禁止关键词（可选）</label>
                <input
                  id="forbiddenKeyword"
                  type="text"
                  value={forbiddenKeyword}
                  onChange={e => setForbiddenKeyword(e.target.value)}
                  placeholder="例如: 离线 或 offline"
                />
                <span className="form-hint">
                  响应内容包含此关键词则判定为故障（用于监控探针页面）
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {checkType === 'komari' && (
        <div className="form-section">
          <h4>Komari Configuration</h4>
          <div className="form-group">
            <label htmlFor="komariOfflineThreshold">离线判断阈值（分钟）</label>
            <input
              id="komariOfflineThreshold"
              type="number"
              min="1"
              max="60"
              value={komariOfflineThreshold}
              onChange={e => setKomariOfflineThreshold(e.target.value)}
            />
            <span className="form-hint">服务器超过此时间未更新状态则判定为离线</span>
          </div>
          <div className="form-group">
            <label htmlFor="expectedKeyword">监控目标服务器（可选）</label>
            <input
              id="expectedKeyword"
              type="text"
              value={expectedKeyword}
              onChange={e => setExpectedKeyword(e.target.value)}
              placeholder="例如: FR①,HK-①,oracle"
            />
            <span className="form-hint">
              填写完整服务器名称，多个用逗号分隔；留空则监控所有服务器
            </span>
          </div>
          <div className="form-group">
            <span
              className="form-hint"
              style={{
                display: 'block',
                marginTop: '8px',
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px'
              }}
            >
              <strong>URL 格式：</strong>填写 Komari 面板的 API 地址，例如：
              <br />
              <code
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}
              >
                https://your-domain.com/api/client
              </code>
            </span>
          </div>
          <div className="form-group">
            <label htmlFor="tgNotifyChatId">TG 通知群组 ID（可选）</label>
            <input
              id="tgNotifyChatId"
              type="text"
              value={tgNotifyChatId}
              onChange={e => setTgNotifyChatId(e.target.value)}
              placeholder="例如: -1001234567890"
            />
            <span className="form-hint">
              触发告警时同步发送消息到此 TG 群组，便于观察误报情况（需先在顶栏配置 Bot Token）
            </span>
          </div>
        </div>
      )}

      {checkType === 'komari_webhook' && (
        <div className="form-section">
          <h4>Komari Webhook Configuration</h4>
          <div className="form-group">
            <label htmlFor="expectedKeyword">监控目标服务器（用于匹配 Komari 通知）</label>
            <input
              id="expectedKeyword"
              type="text"
              value={expectedKeyword}
              onChange={e => setExpectedKeyword(e.target.value)}
              placeholder="服务器名称（多个用逗号分隔）"
              required
            />
            <span className="form-hint">
              当收到 Komari 通知时，会匹配此名称触发告警和 Webhook（需先在 📡 设置启用接收）
            </span>
          </div>
          <div className="form-group">
            <span
              className="form-hint"
              style={{
                display: 'block',
                marginTop: '8px',
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px'
              }}
            >
              <strong>📡 Komari Webhook 监控说明：</strong>
              <br />
              1. 在顶栏 📡 按钮中启用 Komari 通知接收并填写 TG 群组 ID
              <br />
              2. 在 Komari 面板设置 Webhook 指向：
              <code
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}
              >
                https://你的域名/api/komari-notify
              </code>
              <br />
              3. 收到离线通知时会匹配此监控项并触发下方配置的 Webhook
            </span>
          </div>
        </div>
      )}

      {checkType === 'nezha_webhook' && (
        <div className="form-section">
          <h4>Nezha Webhook Configuration</h4>
          <div className="form-group">
            <label htmlFor="expectedKeyword">服务器名称 (Server Name)</label>
            <input
              id="expectedKeyword"
              type="text"
              value={expectedKeyword}
              onChange={e => setExpectedKeyword(e.target.value)}
              placeholder="例如: US-Node-1"
              required
            />
            <span className="form-hint">
              填写哪吒面板中显示的服务器名称。收到 Webhook 通知时，会通过此名称匹配监控项。
            </span>
          </div>
          <div className="form-group">
            <span
              className="form-hint"
              style={{
                display: 'block',
                marginTop: '8px',
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px'
              }}
            >
              <strong>📡 Nezha Webhook 配置说明：</strong>
              <br />
              1. 确保已在 📡 设置中启用 Nezha 通知接收
              <br />
              2. 在哪吒面板添加通知方式：Webhook
              <br />
              3. URL:{' '}
              <code
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}
              >
                {window.location.protocol}//{window.location.host}/api/nezha-notify-v1
              </code>
              <br />
              4. 这里的"服务器名称"必须与哪吒面板中的名称完全一致
            </span>
          </div>
        </div>
      )}

      {checkType === 'scheduled_webhook' && (
        <div className="form-section">
          <h4>Notification Config (Telegram)</h4>
          <div className="form-group">
            <label htmlFor="tgNotifyChatId">TG Chat ID (for Notifications)</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                id="tgNotifyChatId"
                type="text"
                value={tgNotifyChatId}
                onChange={e => setTgNotifyChatId(e.target.value)}
                placeholder="例如: -1001234567890"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  if (!tgNotifyChatId.trim()) {
                    alert('请先输入群组 ID')
                    return
                  }
                  try {
                    const result = await testTelegramChat(tgNotifyChatId.trim())
                    alert(result.message)
                  } catch (err: any) {
                    alert('测试失败: ' + err.message)
                  }
                }}
                style={{ whiteSpace: 'nowrap' }}
              >
                📡 Test Connection
              </button>
            </div>
            <span className="form-hint">
              每次任务执行（无论成功失败）都会发送通知到此群组，并附带重试按钮
            </span>
          </div>

          <div
            className="form-group"
            style={{
              background: 'var(--bg-secondary)',
              padding: '16px',
              borderRadius: '12px',
              marginTop: '16px',
              border: '1px solid var(--border-color)'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px'
              }}
            >
              <h5 style={{ margin: 0, fontSize: '1.1rem' }}>
                🔗 反馈联动模式 (Feedback Linkage Mode)
              </h5>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={feedbackLinkage}
                  onChange={e => setFeedbackLinkage(e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {feedbackLinkage && (
              <div
                className="feedback-linkage-settings"
                style={{
                  padding: '12px',
                  background: 'var(--bg-primary)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}
              >
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="feedbackThreshold_alt">续期触发阈值 (小时)</label>
                    <input
                      id="feedbackThreshold_alt"
                      type="number"
                      value={feedbackThreshold}
                      onChange={e => setFeedbackThreshold(e.target.value)}
                      placeholder="例如: 24"
                    />
                  </div>
                  <div className="form-group">
                    <label>执行波动范围 (小时)</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        type="number"
                        value={feedbackFluctuationMin}
                        onChange={e => setFeedbackFluctuationMin(e.target.value)}
                        style={{ flex: 1 }}
                        placeholder="Min"
                      />
                      <span style={{ fontSize: '14px' }}>至</span>
                      <input
                        type="number"
                        value={feedbackFluctuationMax}
                        onChange={e => setFeedbackFluctuationMax(e.target.value)}
                        style={{ flex: 1 }}
                        placeholder="Max"
                      />
                    </div>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '12px', marginBottom: 0 }}>
                  <label>脚本回调 URL</label>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'var(--bg-tertiary)',
                      padding: '8px 12px',
                      borderRadius: '6px'
                    }}
                  >
                    <code
                      style={{
                        fontSize: '0.9rem',
                        color: 'var(--accent-color)',
                        wordBreak: 'break-all'
                      }}
                    >
                      {window.location.protocol}//{window.location.host}/api/callback
                    </code>
                    <button
                      type="button"
                      className="btn-text"
                      onClick={() => {
                        const url = `${window.location.protocol}//{window.location.host}/api/callback`
                        navigator.clipboard.writeText(url)
                        alert('已复制到剪贴板')
                      }}
                      title="复制链接"
                    >
                      📋
                    </button>
                  </div>
                  <span className="form-hint" style={{ marginTop: '8px' }}>
                    <strong>Payload:</strong>{' '}
                    <code>
                      {'{'} "server_name": "{expectedKeyword || '你的关键词'}", "remaining_time": 秒{' '}
                      {'}'}
                    </code>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {checkType === 'telegram' && (
        <div className="form-section">
          <h4>Telegram Configuration</h4>
          <div className="form-group">
            <label htmlFor="tgChatId">群组 ID</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                id="tgChatId"
                type="text"
                value={tgChatId}
                onChange={e => setTgChatId(e.target.value)}
                placeholder="例如: -1001234567890"
                required
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  if (!tgChatId.trim()) {
                    alert('请先输入群组 ID')
                    return
                  }
                  try {
                    const result = await testTelegramChat(tgChatId.trim())
                    alert(result.message)
                  } catch (err: any) {
                    alert('测试失败: ' + err.message)
                  }
                }}
                style={{ whiteSpace: 'nowrap' }}
              >
                📡 测试连接
              </button>
            </div>
            <span className="form-hint">Telegram 群组 ID（负数），可通过 @userinfobot 获取</span>
          </div>
          <div className="form-group">
            <label htmlFor="tgServerName">服务器名称</label>
            <input
              id="tgServerName"
              type="text"
              value={tgServerName}
              onChange={e => setTgServerName(e.target.value)}
              placeholder="例如: streamlit,my-server"
              required
            />
            <span className="form-hint">
              消息中需包含的服务器名称，多个用逗号分隔（从通知消息的"主机名称"字段提取）
            </span>
          </div>
          <div className="form-group">
            <label htmlFor="tgOfflineKeywords">离线关键词</label>
            <input
              id="tgOfflineKeywords"
              type="text"
              value={tgOfflineKeywords}
              onChange={e => setTgOfflineKeywords(e.target.value)}
              placeholder="离线,offline,down,掉线"
            />
            <span className="form-hint">消息包含这些关键词时判定为离线，多个用逗号分隔</span>
          </div>
          <div className="form-group">
            <label htmlFor="tgOnlineKeywords">上线关键词</label>
            <input
              id="tgOnlineKeywords"
              type="text"
              value={tgOnlineKeywords}
              onChange={e => setTgOnlineKeywords(e.target.value)}
              placeholder="上线,online,up,恢复"
            />
            <span className="form-hint">消息包含这些关键词时判定为上线，多个用逗号分隔</span>
          </div>
          <div className="form-group">
            <span
              className="form-hint"
              style={{
                display: 'block',
                marginTop: '8px',
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px'
              }}
            >
              <strong>使用说明：</strong>
              <br />
              1. 先在顶栏 🤖 按钮配置 Bot Token
              <br />
              2. 将 Bot 加入到监控的群组
              <br />
              3. 填写群组 ID 和服务器名称（从通知消息中提取）
              <br />
              4. 根据通知消息格式设置离线/上线关键词
            </span>
          </div>
        </div>
      )}

      <div className="form-section">
        <h4>Webhook通知（可选）</h4>

        <div className="form-group">
          <label htmlFor="webhook">Webhook URL</label>
          <input
            id="webhook"
            type="url"
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/..."
          />
          <span className="form-hint">故障时发送通知到此地址</span>
        </div>

        <div className="form-group">
          <label htmlFor="contentType">Content-Type</label>
          <input
            id="contentType"
            type="text"
            value={contentType}
            onChange={e => setContentType(e.target.value)}
            placeholder="application/json"
          />
        </div>

        <div className="form-group">
          <label htmlFor="username">用户名（Basic Auth，可选）</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="用于Basic认证"
          />
        </div>

        <div className="form-group">
          <label htmlFor="headers">自定义Headers（JSON格式，可选）</label>
          <textarea
            id="headers"
            value={headers}
            onChange={e => setHeaders(e.target.value)}
            placeholder='{"Authorization": "Bearer token"}'
            rows={3}
          />
        </div>

        <div className="form-group">
          <label htmlFor="body">自定义Body（JSON格式，可选）</label>
          <textarea
            id="body"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder='{"event_type": "monitor_alert", "name": "{{monitor_name}}"}'
            rows={4}
          />
          <span className="form-hint">
            可用变量: {`{{monitor_name}}, {{monitor_url}}, {{status}}, {{error}}, {{timestamp}}`}
          </span>
        </div>
      </div>

      <div className="form-actions">
        {isEditMode && onCancel && (
          <button type="button" className="btn-secondary" onClick={onCancel}>
            取消
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting
            ? isEditMode
              ? '保存中...'
              : '添加中...'
            : isEditMode
              ? '保存'
              : '添加监控'}
        </button>
      </div>
    </form>
  )
}

import { FormEvent, useEffect, useRef, useState } from 'react'
import { Fingerprint, KeyRound, LockKeyhole, ShieldCheck, Trash2, X } from 'lucide-react'
import { startRegistration } from '@simplewebauthn/browser'
import {
  beginPasskeyRegistration,
  beginTotpSetup,
  confirmTotpSetup,
  deletePasskey,
  disableTotp,
  finishPasskeyRegistration,
  getTwoFactorStatus,
  TwoFactorAccessError,
  unlockTwoFactorSettings,
  type TotpSetupResponse,
  type TwoFactorStatus,
} from '../lib/api'
import './TwoFactorSettings.css'

export default function TwoFactorSettings() {
  const [open, setOpen] = useState(false)
  const [accessToken, setAccessToken] = useState('')
  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [password, setPassword] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const passwordInputRef = useRef<HTMLInputElement>(null)

  const passkeySupported = window.isSecureContext && 'PublicKeyCredential' in window

  function resetSensitiveState() {
    setAccessToken('')
    setStatus(null)
    setPassword('')
    setPasskeyName('')
    setSetup(null)
    setCode('')
    setMessage('')
    setError('')
    setBusy(false)
  }

  function closeDialog() {
    setOpen(false)
    resetSensitiveState()
  }

  function lockDialog(message = '安全验证已过期，请重新输入当前密码') {
    setAccessToken('')
    setStatus(null)
    setPassword('')
    setPasskeyName('')
    setSetup(null)
    setCode('')
    setMessage('')
    setError(message)
  }

  useEffect(() => {
    if (!open || accessToken) return
    passwordInputRef.current?.focus()
  }, [open, accessToken])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDialog()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  useEffect(() => resetSensitiveState, [])

  async function loadStatus(token: string) {
    setStatus(await getTwoFactorStatus(token))
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (err) {
      if (err instanceof TwoFactorAccessError) {
        lockDialog()
      } else {
        setError(err instanceof Error ? err.message : '操作失败，请稍后重试')
      }
    } finally {
      setBusy(false)
    }
  }

  function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    run(async () => {
      if (!password) throw new Error('请输入当前管理员密码')
      const access = await unlockTwoFactorSettings(password)
      await loadStatus(access.access_token)
      setAccessToken(access.access_token)
      setPassword('')
    })
  }

  function startTotpSetup() {
    run(async () => {
      setSetup(await beginTotpSetup(accessToken))
      setCode('')
    })
  }

  function finishTotpSetup() {
    run(async () => {
      if (!setup || code.length !== 6) throw new Error('请输入 6 位动态验证码')
      await confirmTotpSetup(accessToken, setup.setup_token, setup.secret, code)
      setSetup(null)
      setCode('')
      setMessage('动态验证码两步验证已开启')
      await loadStatus(accessToken)
    })
  }

  function turnOffTotp() {
    run(async () => {
      await disableTotp(accessToken)
      setSetup(null)
      setMessage('动态验证码两步验证已关闭')
      await loadStatus(accessToken)
    })
  }

  function registerPasskey() {
    run(async () => {
      if (!passkeySupported) throw new Error('通行密钥需要 HTTPS 或 localhost 环境')
      const options = await beginPasskeyRegistration(accessToken, passkeyName.trim() || '通行密钥')
      const credential = await startRegistration({ optionsJSON: options })
      await finishPasskeyRegistration(accessToken, options.challenge, credential)
      setPasskeyName('')
      setMessage('通行密钥注册成功')
      await loadStatus(accessToken)
    })
  }

  function removePasskey(id: number) {
    run(async () => {
      await deletePasskey(id, accessToken)
      setMessage('通行密钥已删除')
      await loadStatus(accessToken)
    })
  }

  return (
    <section className="two-factor-settings">
      <div className="two-factor-heading">
        <ShieldCheck size={26} aria-hidden="true" />
        <div>
          <h3>两步验证</h3>
          <p>使用动态验证码保护密码登录，或注册通行密钥进行免密登录。</p>
        </div>
      </div>

      <div className="two-factor-entry-card">
        <LockKeyhole size={22} aria-hidden="true" />
        <div>
          <strong>安全设置需要再次验证身份</strong>
          <span>进入管理界面后，可在短时间内连续完成相关操作。</span>
        </div>
        <button type="button" className="security-primary" onClick={() => setOpen(true)}>
          管理两步验证
        </button>
      </div>

      {open && (
        <div className="two-factor-dialog-overlay" onMouseDown={event => {
          if (event.target === event.currentTarget) closeDialog()
        }}>
          <div className="two-factor-dialog" role="dialog" aria-modal="true" aria-labelledby="two-factor-dialog-title">
            <header className="two-factor-dialog-header">
              <div>
                <ShieldCheck size={22} aria-hidden="true" />
                <div>
                  <h3 id="two-factor-dialog-title">管理两步验证</h3>
                  <p>{accessToken ? '管理动态验证码与通行密钥' : '请先验证当前管理员密码'}</p>
                </div>
              </div>
              <button type="button" className="two-factor-dialog-close" onClick={closeDialog} aria-label="关闭两步验证管理窗口">
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="two-factor-dialog-body">
              {error && <div className="two-factor-alert error" role="alert">{error}</div>}
              {message && <div className="two-factor-alert success" role="status">{message}</div>}

              {!accessToken ? (
                <form className="two-factor-unlock" onSubmit={unlock}>
                  <LockKeyhole size={32} aria-hidden="true" />
                  <div>
                    <h4>验证当前密码</h4>
                    <p>验证成功后，本次窗口内的两步验证管理操作无需重复输入密码。</p>
                  </div>
                  <label htmlFor="security-current-password">当前管理员密码</label>
                  <input
                    ref={passwordInputRef}
                    id="security-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    disabled={busy}
                  />
                  <button type="submit" className="security-primary" disabled={busy || !password}>
                    {busy ? '正在验证...' : '验证并进入'}
                  </button>
                </form>
              ) : status ? (
                <div className="two-factor-management">
                  <div className="two-factor-card">
                    <div className="two-factor-card-title">
                      <KeyRound size={20} aria-hidden="true" />
                      <div>
                        <h4>身份验证器动态码</h4>
                        <span className={status.totp_enabled ? 'status-enabled' : 'status-disabled'}>
                          {status.totp_enabled ? '已开启' : '未开启'}
                        </span>
                      </div>
                    </div>

                    {setup ? (
                      <div className="totp-setup">
                        <p>在身份验证器应用中输入以下密钥，或通过支持 otpauth 的应用导入。</p>
                        <code>{setup.secret}</code>
                        在身份验证器应用中使用上方密钥完成设置
                        <label htmlFor="totp-confirm-code">6 位动态验证码</label>
                        <input
                          id="totp-confirm-code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={code}
                          onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="000000"
                          disabled={busy}
                        />
                        <div className="two-factor-actions">
                          <button type="button" className="security-primary" onClick={finishTotpSetup} disabled={busy || code.length !== 6}>确认开启</button>
                          <button type="button" className="security-secondary" onClick={() => { setSetup(null); setCode('') }} disabled={busy}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className={status.totp_enabled ? 'security-danger' : 'security-primary'} onClick={status.totp_enabled ? turnOffTotp : startTotpSetup} disabled={busy}>
                        {status.totp_enabled ? '关闭动态验证码' : '设置动态验证码'}
                      </button>
                    )}
                  </div>

                  <div className="two-factor-card">
                    <div className="two-factor-card-title">
                      <Fingerprint size={20} aria-hidden="true" />
                      <div>
                        <h4>通行密钥</h4>
                        <span>{status.passkeys.length} 个已注册</span>
                      </div>
                    </div>

                    {status.passkeys.length > 0 ? (
                      <ul className="passkey-list">
                        {status.passkeys.map(passkey => (
                          <li key={passkey.id}>
                            <div>
                              <strong>{passkey.name || '通行密钥'}</strong>
                              <span>{new Date(passkey.created_at).toLocaleString()}</span>
                            </div>
                            <button type="button" className="passkey-delete" onClick={() => removePasskey(passkey.id)} disabled={busy} aria-label={`删除通行密钥 ${passkey.name || passkey.id}`}>
                              <Trash2 size={17} aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="two-factor-empty">尚未注册通行密钥。</p>}

                    <label htmlFor="passkey-name">通行密钥名称</label>
                    <input id="passkey-name" value={passkeyName} onChange={event => setPasskeyName(event.target.value)} placeholder="例如：办公室电脑" disabled={busy || !passkeySupported} />
                    <button type="button" className="security-primary" onClick={registerPasskey} disabled={busy || !passkeySupported}>注册通行密钥</button>
                    {!passkeySupported && <p className="two-factor-browser-note">当前浏览器环境不支持 WebAuthn。请通过 HTTPS 或 localhost 使用通行密钥。</p>}
                  </div>
                </div>
              ) : <div className="two-factor-loading">正在加载安全设置...</div>}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

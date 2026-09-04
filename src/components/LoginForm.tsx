import { useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { startAuthentication } from '@simplewebauthn/browser'
import {
  beginPasskeyLogin,
  finishPasskeyLogin,
  verifyTotpLogin,
  type LoginResponse,
} from '../lib/api'
import './LoginForm.css'

interface LoginFormProps {
  onLogin: (password: string) => Promise<LoginResponse>
  onAuthenticated: (token: string) => void
}

export default function LoginForm({ onLogin, onAuthenticated }: LoginFormProps) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [ticket, setTicket] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isTotpStep = Boolean(ticket)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const response = isTotpStep
        ? await verifyTotpLogin(ticket, code)
        : await onLogin(password)

      if (response.token) {
        onAuthenticated(response.token)
        return
      }

      if (response.twoFactor?.required) {
        setTicket(response.twoFactor.ticket)
        setCode('')
        return
      }

      setError(isTotpStep ? '动态验证码错误，请重试' : '密码错误，请重试')
      if (!isTotpStep) setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handlePasskeyLogin() {
    setError('')
    setIsSubmitting(true)
    try {
      const options = await beginPasskeyLogin()
      const credential = await startAuthentication({ optionsJSON: options })
      const response = await finishPasskeyLogin(options.challenge, credential)
      if (!response.token) throw new Error('通行密钥登录失败')
      onAuthenticated(response.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : '通行密钥登录失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  function returnToPassword() {
    setTicket('')
    setCode('')
    setError('')
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>CloudEye</h1>
        <p className="login-subtitle">
          {isTotpStep ? '输入身份验证器中的 6 位动态码' : '请输入管理员密码'}
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor={isTotpStep ? 'totp-code' : 'admin-password'}>
              {isTotpStep ? '动态验证码' : '管理员密码'}
            </label>
            <input
              id={isTotpStep ? 'totp-code' : 'admin-password'}
              type={isTotpStep ? 'text' : 'password'}
              inputMode={isTotpStep ? 'numeric' : undefined}
              autoComplete={isTotpStep ? 'one-time-code' : 'current-password'}
              value={isTotpStep ? code : password}
              onChange={(e) => {
                if (isTotpStep) setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                else setPassword(e.target.value)
              }}
              placeholder={isTotpStep ? '000000' : '请输入密码'}
              required
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          {error && <div className="error-message" role="alert">{error}</div>}

          <button
            type="submit"
            className="btn-login"
            disabled={isSubmitting || (isTotpStep ? code.length !== 6 : !password)}
          >
            {isSubmitting ? '验证中...' : isTotpStep ? '验证并登录' : '登录'}
          </button>

          {isTotpStep ? (
            <button type="button" className="btn-login-secondary" onClick={returnToPassword} disabled={isSubmitting}>
              返回密码登录
            </button>
          ) : (
            typeof window !== 'undefined' && window.isSecureContext && (
              <button type="button" className="btn-login-secondary" onClick={handlePasskeyLogin} disabled={isSubmitting}>
                <Fingerprint size={18} aria-hidden="true" />
                使用通行密钥登录
              </button>
            )
          )}
        </form>
      </div>
    </div>
  )
}

import type { Request } from 'express'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { queryAll, queryFirst, run } from './db.js'

// ---------------------------------------------------------------------------
// Passkey 凭证（WebAuthn / @simplewebauthn/server）
// ---------------------------------------------------------------------------
// 参考 browser-automation-panel 的实现：residentKey=required + userVerification=required
// 让凭证可发现（discoverable），登录页免输账号直接列出候选；userVerification 保证
// 密钥本身做过生物/PIN 解锁——它是免密通道，必须比"密码+TOTP"更严。
// challenge 存内存 Map，5 分钟过期，取用即删（单次）。
// ---------------------------------------------------------------------------

export interface PasskeyRow {
  id: number
  credential_id: string
  public_key: string
  counter: number
  transports: string
  user_handle: string
  name: string
  created_at: string
}

const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000
const passkeyChallenges = new Map<string, { kind: string; userId?: number; name?: string; expiresAt: number }>()

function storePasskeyChallenge(challenge: string, payload: { kind: string; userId?: number; name?: string }) {
  passkeyChallenges.set(challenge, { ...payload, expiresAt: Date.now() + PASSKEY_CHALLENGE_TTL_MS })
}

function takePasskeyChallenge(challenge: string, kind: string) {
  if (!challenge) return null
  const rec = passkeyChallenges.get(challenge)
  if (!rec) return null
  passkeyChallenges.delete(challenge)
  if (rec.kind !== kind || Date.now() > rec.expiresAt) return null
  return rec
}

// 清理过期 challenge，防止 Map 无限增长
setInterval(() => {
  const now = Date.now()
  for (const [key, rec] of passkeyChallenges) {
    if (now > rec.expiresAt) passkeyChallenges.delete(key)
  }
}, 5 * 60 * 1000).unref()

// ---------------------------------------------------------------------------
// RP ID / origin 解析（按请求动态解析，兼容反代 / CF 隧道）
// ---------------------------------------------------------------------------

function isHttps(req: Request): boolean {
  if (req.secure) return true
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
}

export function rpID(req: Request): string {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  return host.replace(/:\d+$/, '').toLowerCase()
}

export function originFromRequest(req: Request): string {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  const proto =
    String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (isHttps(req) ? 'https' : 'http')
  return `${proto}://${host}`
}

// ---------------------------------------------------------------------------
// DB 操作
// ---------------------------------------------------------------------------

export function listPasskeys(): PasskeyRow[] {
  return queryAll('SELECT * FROM passkeys ORDER BY id ASC') as PasskeyRow[]
}

export function hasAnyPasskey(): boolean {
  const row = queryFirst('SELECT 1 FROM passkeys LIMIT 1') as { '1': number } | null
  return Boolean(row)
}

export function getPasskeyByCredentialId(credentialId: string): PasskeyRow | null {
  return queryFirst('SELECT * FROM passkeys WHERE credential_id = ?', [credentialId]) as PasskeyRow | null
}

export function addPasskey(data: {
  credentialId: string
  publicKey: string
  counter: number
  transports: string
  userHandle: string
  name: string
}): void {
  run(
    `INSERT INTO passkeys (credential_id, public_key, counter, transports, user_handle, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [data.credentialId, data.publicKey, data.counter, data.transports, data.userHandle, data.name]
  )
}

export function updatePasskeyCounter(credentialId: string, counter: number): void {
  run('UPDATE passkeys SET counter = ?, updated_at = datetime(\'now\') WHERE credential_id = ?', [
    counter,
    credentialId
  ])
}

export function deletePasskeyById(id: number): void {
  run('DELETE FROM passkeys WHERE id = ?', [id])
}

function safeParseTransports(raw: string | null | undefined): string[] {
  try {
    const arr = JSON.parse(String(raw || '[]'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 注册流程
// ---------------------------------------------------------------------------

export async function generateRegistrationOptionsData(req: Request, name: string) {
  const existing = listPasskeys()
  const options = await generateRegistrationOptions({
    rpName: 'CloudEye',
    rpID: rpID(req),
    userName: 'admin',
    userID: Buffer.from('admin'),
    userDisplayName: 'Admin',
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials: existing.map(pk => ({
      id: pk.credential_id,
      transports: safeParseTransports(pk.transports),
    })),
  })
  storePasskeyChallenge(options.challenge, { kind: 'register', userId: 1, name })
  return options
}

export async function verifyRegistrationResponseData(req: Request, challenge: string, response: unknown) {
  const rec = takePasskeyChallenge(challenge, 'register')
  if (!rec) {
    return { ok: false, message: '注册凭证已过期，请重新开始' }
  }
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: response as never,
      expectedChallenge: challenge,
      expectedOrigin: originFromRequest(req),
      expectedRPID: rpID(req),
    })
    if (!verified || !registrationInfo) {
      return { ok: false, message: '通行密钥注册校验失败' }
    }
    const { credential } = registrationInfo
    if (getPasskeyByCredentialId(credential.id)) {
      return { ok: false, message: '该通行密钥已注册过' }
    }
    addPasskey({
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: JSON.stringify(credential.transports || []),
      userHandle: isoBase64URL.fromBuffer(Buffer.from('admin')),
      name: rec.name || '',
    })
    return { ok: true }
  } catch (error: any) {
    return { ok: false, message: error?.message || '通行密钥注册校验失败' }
  }
}

// ---------------------------------------------------------------------------
// 登录（免密）流程
// ---------------------------------------------------------------------------

export async function generateLoginChallengeOptions(req: Request) {
  const options = await generateAuthenticationOptions({
    rpID: rpID(req),
    allowCredentials: [],
    userVerification: 'required',
  })
  storePasskeyChallenge(options.challenge, { kind: 'login' })
  return options
}

export async function verifyLoginResponseData(req: Request, challenge: string, response: any) {
  const rec = takePasskeyChallenge(challenge, 'login')
  if (!rec) {
    return { ok: false, message: '登录凭证已过期，请刷新后重试' }
  }
  const passkey = response && response.id ? getPasskeyByCredentialId(response.id) : null
  if (!passkey) {
    return { ok: false, message: '该通行密钥未在本站注册' }
  }
  const returnedHandle = response.response && response.response.userHandle
  if (returnedHandle && passkey.user_handle && returnedHandle !== passkey.user_handle) {
    return { ok: false, message: '通行密钥与账号不匹配' }
  }
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: originFromRequest(req),
      expectedRPID: rpID(req),
      credential: {
        id: passkey.credential_id,
        publicKey: isoBase64URL.toBuffer(passkey.public_key),
        counter: passkey.counter,
      },
    })
    if (!verified) {
      return { ok: false, message: '通行密钥校验失败' }
    }
    updatePasskeyCounter(passkey.credential_id, authenticationInfo.newCounter)
    return { ok: true }
  } catch (error: any) {
    return { ok: false, message: error?.message || '通行密钥校验失败' }
  }
}
import crypto from 'crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_MS = 30 * 1000
const DIGITS = 6
const WINDOW = 1

// 生成随机 base32 秘钥（160 位 = 32 个 base32 字符，无填充）
export function generateSecret(): string {
  const bytes = crypto.randomBytes(20)
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffffffff
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += ALPHABET[(value >>> bits) & 31]
    }
  }
  return out
}

// base32 解码：接受小写、去掉空格和 '=' 填充
function base32Decode(input: string): Buffer {
  const clean = String(input || '').toUpperCase().replace(/[\s=]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >> bits) & 0xff)
    }
  }
  return Buffer.from(out)
}

// HMAC 拆成 6 位数字（RFC 4226 dynamic truncation）
function hotpFromBuffer(hmac: Buffer): string {
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  return String(bin % 1000000).padStart(DIGITS, '0')
}

// 指定时间点（ms）对应的 TOTP 码
export function generateCode(secret: string, atMs = Date.now()): string {
  const key = base32Decode(secret)
  const counter = Math.floor(atMs / STEP_MS)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  return hotpFromBuffer(hmac)
}

// 校验用户输入的 6 位码，接受时区偏移 ±WINDOW 步
export function verifyCode(secret: string, code: string, atMs = Date.now()): boolean {
  const userCode = String(code || '').trim().replace(/\s+/g, '')
  if (!/^\d{6}$/.test(userCode)) return false
  const counter = Math.floor(atMs / STEP_MS)
  const key = base32Decode(secret)
  for (let i = -WINDOW; i <= WINDOW; i += 1) {
    const buf = Buffer.alloc(8)
    buf.writeBigUInt64BE(BigInt(counter + i))
    const hmac = crypto.createHmac('sha1', key).update(buf).digest()
    if (hotpFromBuffer(hmac) === userCode) return true
  }
  return false
}

// otpauth 链接，供二维码 / 手动输入
export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: '30',
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
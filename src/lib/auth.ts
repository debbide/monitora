import { verifyPassword as apiVerifyPassword } from './api'
import type { LoginResponse } from './api'

const AUTH_KEY = 'monitor_auth_token'
const AUTH_EXPIRY = 'monitor_auth_expiry'

export async function verifyPassword(password: string): Promise<LoginResponse> {
  return apiVerifyPassword(password)
}

export function setAuthToken(token: string, expiryHours: number = 24) {
  const expiry = Date.now() + expiryHours * 60 * 60 * 1000
  localStorage.setItem(AUTH_KEY, token)
  localStorage.setItem(AUTH_EXPIRY, expiry.toString())
}

export function getAuthToken(): string | null {
  const token = localStorage.getItem(AUTH_KEY)
  const expiry = localStorage.getItem(AUTH_EXPIRY)

  if (!token || !expiry) {
    return null
  }

  if (Date.now() > parseInt(expiry)) {
    clearAuthToken()
    return null
  }

  return token
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_KEY)
  localStorage.removeItem(AUTH_EXPIRY)
}

export function isAuthenticated(): boolean {
  return getAuthToken() !== null
}

// generateAuthToken removed as we now use backend-generated JWT

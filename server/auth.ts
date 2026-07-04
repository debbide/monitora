import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'
import { queryFirst, run } from './db.js'

// Get or generate JWT secret
function getJwtSecret(): string {
  // Check if we have one in the database
  const row = queryFirst("SELECT value FROM system_settings WHERE key = 'jwt_secret'") as any
  if (row && row.value) {
    return row.value
  }

  // Generate a new secure secret
  const newSecret = crypto.randomBytes(64).toString('hex')
  run("INSERT INTO system_settings (key, value) VALUES ('jwt_secret', ?)", [newSecret])
  console.log('🔑 JWT Secret automatically generated and saved.')
  return newSecret
}

// Generate token (expires in 24 hours)
export function generateToken(): string {
  const secret = getJwtSecret()
  // Include a basic payload, e.g., role: 'admin'
  return jwt.sign({ role: 'admin' }, secret, { expiresIn: '24h' })
}

// Middleware to protect routes
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const secret = getJwtSecret()
    jwt.verify(token, secret)
    next() // Token is valid, proceed
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' })
  }
}

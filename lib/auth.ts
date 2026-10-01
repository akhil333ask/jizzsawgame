import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { botToken, isDev } from './env'

export type SessionUser = { id: number; name: string; username?: string }

const SESSION_TTL_MS = 6 * 60 * 60 * 1000
const INIT_DATA_MAX_AGE_S = 24 * 60 * 60

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  const token = botToken()
  if (token) return createHash('sha256').update(`session:${token}`).digest('hex')
  if (isDev) return 'dev-only-insecure-session-secret'
  throw new Error('SESSION_SECRET or TELEGRAM_BOT_TOKEN must be set')
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Validates Telegram Mini App initData per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
export function verifyInitData(initData: string): SessionUser | null {
  const token = botToken()
  if (!token || !initData || initData.length > 4096) {
    console.warn('[auth] initData rejected: missing token or bad length')
    return null
  }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) {
    console.warn('[auth] initData rejected: no hash')
    return null
  }
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest()
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  if (!safeEqual(expected, hash)) {
    console.warn('[auth] initData rejected: hash mismatch (check TELEGRAM_BOT_TOKEN matches the bot opening the app)')
    return null
  }

  const authDate = Number(params.get('auth_date'))
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_S) {
    console.warn('[auth] initData rejected: expired auth_date')
    return null
  }

  try {
    const user = JSON.parse(params.get('user') ?? 'null')
    if (!user || typeof user.id !== 'number') return null
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 64) || 'Trainer'
    return { id: user.id, name, username: user.username }
  } catch {
    return null
  }
}

export function signSession(user: SessionUser) {
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + SESSION_TTL_MS }),
  ).toString('base64url')
  const sig = createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifySession(token: string | null | undefined): SessionUser | null {
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
  if (!safeEqual(expected, sig)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null
    return { id: data.id, name: data.name, username: data.username }
  } catch {
    return null
  }
}

export function sessionFromRequest(req: Request): SessionUser | null {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return verifySession(header.slice(7))
}

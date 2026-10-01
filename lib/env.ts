import { createHash } from 'node:crypto'

export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '')
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  if (process.env.V0_RUNTIME_URL) return process.env.V0_RUNTIME_URL.replace(/\/$/, '')
  return 'http://localhost:3000'
}

/** Trimmed because pasted tokens often carry a trailing newline, which Telegram's API URL ignores but HMAC checks do not. */
export const botToken = () => (process.env.TELEGRAM_BOT_TOKEN ?? '').trim()

export const webhookSecret = () =>
  (process.env.TELEGRAM_WEBHOOK_SECRET_2 || process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()

/** Telegram only accepts [A-Za-z0-9_-] in secret_token, so send a hash of the configured secret instead. */
export function telegramSecretToken() {
  const secret = webhookSecret()
  return secret ? createHash('sha256').update(secret).digest('hex') : ''
}

export const isDev = process.env.NODE_ENV === 'development'

/**
 * Deep link that opens the Mini App inside Telegram with a start parameter.
 * Requires a Mini App registered in BotFather (/newapp); falls back to the web URL.
 */
export function miniAppLink(startParam: string) {
  const base = process.env.TELEGRAM_MINIAPP_URL
  if (base) return `${base.replace(/\/$/, '')}?startapp=${encodeURIComponent(startParam)}`
  return `${appUrl()}/play?start=${encodeURIComponent(startParam)}`
}

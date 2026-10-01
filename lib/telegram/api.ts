import { botToken, miniAppLink } from '../env'

export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }
  | { text: string; web_app: { url: string } }

export type InlineKeyboard = { inline_keyboard: InlineButton[][] }

export async function tg<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  const token = botToken()
  if (!token) return null
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!data.ok) {
      console.error(`[telegram] ${method} failed:`, data.description)
      return null
    }
    return data.result as T
  } catch (error) {
    console.error(`[telegram] ${method} error:`, error)
    return null
  }
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const mention = (id: number, name: string) => `<a href="tg://user?id=${id}">${escapeHtml(name)}</a>`

type BotInfo = { username: string; has_main_web_app?: boolean }
let cachedMe: { info: BotInfo; at: number } | undefined
const ME_TTL_MS = 5 * 60 * 1000

async function getMe() {
  if (cachedMe && Date.now() - cachedMe.at < ME_TTL_MS) return cachedMe.info
  const info = await tg<BotInfo>('getMe', {})
  if (info) cachedMe = { info, at: Date.now() }
  return info ?? cachedMe?.info
}

export async function botUsername() {
  const fromEnv = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '')
  if (fromEnv) return fromEnv
  return (await getMe())?.username
}

/**
 * Group chats cannot use web_app buttons, so launches go through a t.me deep link.
 * Prefers TELEGRAM_MINIAPP_URL, then the bot's Main Mini App. Without a Main Mini App,
 * `?startapp=` fails with BOT_INVALID, so fall back to `?start=` which opens a private
 * chat where the bot replies with a web_app button.
 */
export async function launchLink(startParam: string) {
  if (process.env.TELEGRAM_MINIAPP_URL) return miniAppLink(startParam)
  const me = await getMe()
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '') || me?.username
  if (!username) return miniAppLink(startParam)
  const param = encodeURIComponent(startParam)
  return me?.has_main_web_app ? `https://t.me/${username}?startapp=${param}` : `https://t.me/${username}?start=${param}`
}

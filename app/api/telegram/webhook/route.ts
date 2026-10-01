import { timingSafeEqual } from 'node:crypto'
import { scheduleDuelCountdown } from '@/lib/api'
import { telegramSecretToken } from '@/lib/env'
import { handleUpdate, type TgUpdate } from '@/lib/telegram/bot'

// The 1v1 flow keeps running after the webhook has answered: a 60s accept window plus a 45s ready window.
export const maxDuration = 150

function validSecret(received: string | null) {
  const expected = telegramSecretToken()
  if (!expected || !received) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  if (!validSecret(req.headers.get('x-telegram-bot-api-secret-token'))) {
    return new Response('Forbidden', { status: 403 })
  }
  try {
    const update = (await req.json()) as TgUpdate
    const followUp = await handleUpdate(update)
    if (followUp?.duelCountdown) scheduleDuelCountdown(followUp.duelCountdown)
  } catch (error) {
    console.error('[telegram] update handling failed', error)
  }
  // Always 200 so Telegram doesn't retry-storm on a bad update.
  return new Response('ok')
}

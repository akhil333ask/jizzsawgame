import { timingSafeEqual } from 'node:crypto'
import { appUrl, botToken, telegramSecretToken, webhookSecret } from '@/lib/env'
import { tg } from '@/lib/telegram/api'

/** One-time bot registration. Visit /api/telegram/setup?key=<TELEGRAM_WEBHOOK_SECRET> after deploying. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = (url.searchParams.get('key') ?? '').trim()
  const secret = webhookSecret()
  const ok = secret && key.length === secret.length && timingSafeEqual(Buffer.from(key), Buffer.from(secret))
  if (!ok) return new Response('Forbidden', { status: 403 })
  if (!botToken()) return Response.json({ error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500 })

  // Per-deployment URLs sit behind Vercel Deployment Protection, so always register the stable production domain.
  const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? appUrl() : url.origin
  const webhook = await tg('setWebhook', {
    url: `${origin}/api/telegram/webhook`,
    secret_token: telegramSecretToken(),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  })
  const commands = await tg('setMyCommands', {
    commands: [
      { command: 'start', description: 'How to play + game menu' },
      { command: 'easy', description: 'Easy 3x3 puzzle - Solo, 1v1 or Multiplayer' },
      { command: 'medium', description: 'Medium 4x4 puzzle - Solo, 1v1 or Multiplayer' },
      { command: 'hard', description: 'Hard 5x5 puzzle - Solo, 1v1 or Multiplayer' },
      { command: 'flee', description: 'Leave or cancel the game you are in' },
      { command: 'leaderboard', description: 'Top trainers' },
      { command: 'help', description: 'All commands and how to play' },
    ],
  })
  const menu = await tg('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Play', web_app: { url: `${origin}/play` } },
  })
  const me = await tg('getMe', {})

  return Response.json({ webhook, commands, menu, bot: me })
}

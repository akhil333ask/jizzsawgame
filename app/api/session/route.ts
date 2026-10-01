import { randomInt } from 'node:crypto'
import { handle, json } from '@/lib/api'
import { signSession, verifyInitData, type SessionUser } from '@/lib/auth'
import { isDev } from '@/lib/env'
import { upsertPlayer } from '@/lib/game/engine'

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => ({}))
    let user: SessionUser | null = null

    if (typeof body.initData === 'string' && body.initData) {
      user = verifyInitData(body.initData)
      if (!user) return json({ error: 'invalid_init_data' }, 401)
    } else if (isDev && body.guest === true) {
      // Local preview only: Telegram never serves the app in development, so allow throwaway guests.
      const id = -randomInt(1_000_000, 2_000_000_000)
      user = { id, name: `Guest ${String(-id).slice(-4)}` }
    } else {
      return json({ error: 'telegram_required' }, 401)
    }

    await upsertPlayer(user)
    return json({ token: signSession(user), user })
  })
}

import { after } from 'next/server'
import { sessionFromRequest, type SessionUser } from './auth'
import { GameError, getRoster, syncGame } from './game/engine'
import { COUNTDOWN_TICK_MS } from './game/rules'
import { notifyTelegram } from './telegram/notify'

const NO_STORE = { 'cache-control': 'no-store, max-age=0' }

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: NO_STORE })
}

export function requireUser(req: Request): SessionUser {
  const user = sessionFromRequest(req)
  if (!user) throw new GameError('unauthorized', 401)
  return user
}

export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof GameError) return json({ error: error.code }, error.status)
    console.error('[api] unexpected error', error)
    return json({ error: 'server_error' }, 500)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Re-edits the 1v1 challenge message until someone accepts or the lobby deadline passes.
 * The final syncGame after the deadline aborts the duel and posts the result.
 */
export function scheduleDuelCountdown(gameId: string) {
  after(async () => {
    try {
      for (let frame = 1; ; frame++) {
        const game = await syncGame(gameId)
        if (!game || game.status !== 'lobby' || !game.lobbyDeadline) return
        const untilDeadline = game.lobbyDeadline.getTime() - Date.now()
        await sleep(Math.max(250, Math.min(COUNTDOWN_TICK_MS, untilDeadline + 500)))

        const next = await syncGame(gameId)
        if (!next || next.status !== 'lobby') return
        const roster = await getRoster(gameId)
        // Once matched, the "both open the puzzle" message replaces the ticker (join/ready events keep it fresh);
        // the loop keeps ticking only so the ready window's deadline still starts the duel if someone never opens it.
        if (roster.length >= next.maxPlayers) continue
        await notifyTelegram(next, 'countdown', roster, { frame })

        // Someone may have accepted while this edit was in flight; restore the "duel on" message if so.
        const latest = await syncGame(gameId)
        if (latest?.status === 'active') {
          await notifyTelegram(latest, 'started', await getRoster(gameId))
          return
        }
      }
    } catch (error) {
      console.error('[duel] countdown loop failed', error)
    }
  })
}

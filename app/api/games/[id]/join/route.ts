import { handle, json, requireUser } from '@/lib/api'
import { joinGame } from '@/lib/game/engine'

/** Called from inside the Mini App, so it also marks the player as ready for the duel countdown. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req)
    const { id } = await params
    const result = await joinGame(id, user, { ready: true })
    return json({ status: result.status })
  })
}

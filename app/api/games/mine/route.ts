import { handle, json, requireUser } from '@/lib/api'
import { listOpenGames } from '@/lib/game/engine'

export async function GET(req: Request) {
  return handle(async () => {
    const user = requireUser(req)
    return json(await listOpenGames(user.id))
  })
}

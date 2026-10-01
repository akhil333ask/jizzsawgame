import { handle, json, requireUser } from '@/lib/api'
import { getGameState } from '@/lib/game/engine'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req)
    const { id } = await params
    return json(await getGameState(id, user.id))
  })
}

import { handle, json, requireUser } from '@/lib/api'
import { hostStart } from '@/lib/game/engine'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req)
    const { id } = await params
    const game = await hostStart(id, user)
    return json({ status: game?.status ?? 'unknown' })
  })
}

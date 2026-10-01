import { handle, json, requireUser } from '@/lib/api'
import { makeMove } from '@/lib/game/engine'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req)
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    return json(await makeMove(id, user, body.piece, body.slot))
  })
}

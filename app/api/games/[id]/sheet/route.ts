import { handle, requireUser } from '@/lib/api'
import { getSheetAccess } from '@/lib/game/engine'
import { buildScrambledSheet } from '@/lib/game/image'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req)
    const { id } = await params
    const game = await getSheetAccess(id, user.id)
    const sheet = await buildScrambledSheet(game.id, game.pokemonId, game.grid, game.perm!)
    return new Response(new Uint8Array(sheet), {
      headers: {
        'content-type': 'image/webp',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  })
}

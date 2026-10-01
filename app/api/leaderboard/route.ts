import { handle, json, requireUser } from '@/lib/api'
import { getLeaderboard, type LeaderboardMode } from '@/lib/game/engine'
import { isGrid } from '@/lib/game/rules'

const MODES: LeaderboardMode[] = ['solo', 'duel', 'multi']

export async function GET(req: Request) {
  return handle(async () => {
    const user = requireUser(req)
    const params = new URL(req.url).searchParams
    const modeParam = params.get('mode') as LeaderboardMode | null
    const mode = modeParam && MODES.includes(modeParam) ? modeParam : 'solo'
    const gridParam = Number(params.get('grid'))
    const rows = await getLeaderboard(mode, isGrid(gridParam) ? gridParam : null)
    return json(rows.map(({ id, ...rest }) => ({ ...rest, isMe: id === user.id })))
  })
}

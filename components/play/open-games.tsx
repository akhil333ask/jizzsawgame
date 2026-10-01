'use client'

import { ChevronRight, Puzzle, Swords, Users } from 'lucide-react'
import useSWR from 'swr'
import { useSession } from './session'

type OpenGame = {
  id: string
  mode: 'solo' | 'duel' | 'multi' | 'battle'
  status: 'lobby' | 'active'
  grid: number
  isHost: boolean
  createdAt: string
}

const DIFFICULTY_BY_GRID: Record<number, string> = { 3: 'Easy', 4: 'Medium', 5: 'Hard' }

function describe(game: OpenGame) {
  const difficulty = DIFFICULTY_BY_GRID[game.grid] ?? `${game.grid}×${game.grid}`
  if (game.mode === 'solo') {
    return { icon: Puzzle, title: `${difficulty} solo puzzle`, detail: game.status === 'lobby' ? 'Ready to start' : 'In progress' }
  }
  const icon = game.mode === 'multi' ? Users : Swords
  const kind = game.mode === 'multi' ? 'multiplayer' : '1v1'
  const detail =
    game.status === 'lobby' ? (game.isHost ? 'Waiting room - you are the host' : 'Waiting room') : 'Battle in progress'
  return { icon, title: `${difficulty} ${kind}`, detail }
}

export function OpenGames({ onOpen }: { onOpen: (gameId: string) => void }) {
  const { api } = useSession()
  const { data } = useSWR('my-open-games', () => api<OpenGame[]>('/api/games/mine'), {
    refreshInterval: 5_000,
    revalidateOnFocus: true,
  })

  if (!data?.length) return null

  return (
    <section aria-labelledby="open-games-heading" className="flex flex-col gap-3">
      <h2 id="open-games-heading" className="font-display text-lg font-bold">
        Your games
      </h2>
      <ul className="flex flex-col gap-2">
        {data.map((game) => {
          const { icon: Icon, title, detail } = describe(game)
          return (
            <li key={game.id}>
              <button
                type="button"
                onClick={() => onOpen(game.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-primary/60 bg-primary/10 px-4 py-3 text-left transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{title}</span>
                  <span className="text-sm text-muted-foreground">{detail}</span>
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold text-accent">
                  Play
                  <ChevronRight className="size-4" aria-hidden />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

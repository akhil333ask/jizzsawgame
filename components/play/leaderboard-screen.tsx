'use client'

import { Crown, Puzzle, Swords, Users } from 'lucide-react'
import { useState } from 'react'
import useSWR from 'swr'
import { DIFFICULTIES, formatDuration } from '@/lib/game/rules'
import { cn } from '@/lib/utils'
import { BrandHero } from './brand-logo'
import { useMusicScene } from './music'
import { MusicToggle } from './music-toggle'
import { OpenGames } from './open-games'
import { useSession } from './session'

type Mode = 'solo' | 'duel' | 'multi'
type Row = {
  name: string
  played: number
  wins: number
  solved: number
  bestMs: number | null
  bestScore: number | null
  isMe: boolean
}

const MODES: { key: Mode; label: string; icon: typeof Puzzle; metric: string }[] = [
  { key: 'solo', label: 'Solo', icon: Puzzle, metric: 'Fastest solve' },
  { key: 'duel', label: '1v1', icon: Swords, metric: 'Most wins' },
  { key: 'multi', label: 'Multiplayer', icon: Users, metric: 'Most wins' },
]

const primaryStat = (mode: Mode, row: Row) =>
  mode === 'solo' ? formatDuration(row.bestMs ?? 0) : String(row.wins)
const primaryUnit = (mode: Mode, row: Row) => (mode === 'solo' ? 'best' : row.wins === 1 ? 'win' : 'wins')
const secondaryStat = (mode: Mode, row: Row) =>
  mode === 'solo'
    ? `${row.solved} solved${row.bestScore ? ` · top score ${row.bestScore}` : ''}`
    : `${row.played} played${row.bestMs ? ` · best ${formatDuration(row.bestMs)}` : ''}`

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?'

export function LeaderboardScreen({ onOpenGame }: { onOpenGame: (gameId: string) => void }) {
  const { inTelegram } = useSession()
  const [mode, setMode] = useState<Mode>('solo')
  const [grid, setGrid] = useState<number | null>(null)
  useMusicScene('leaderboard')

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 px-4 pb-10 pt-2">
      <div className="-mb-5 flex justify-end">
        <MusicToggle />
      </div>
      <header className="flex flex-col items-center gap-1 text-center">
        <BrandHero priority className="max-w-xs" />
        <h1 className="-mt-4 font-display text-3xl font-bold">Leaderboard</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Send <code className="font-mono text-accent">/easy</code>, <code className="font-mono text-accent">/medium</code> or{' '}
          <code className="font-mono text-accent">/hard</code> in your group to play.
        </p>
        {!inTelegram && (
          <span className="mt-1 rounded-full border border-accent/40 px-3 py-1 text-xs text-accent">Preview mode</span>
        )}
      </header>

      <OpenGames onOpen={onOpenGame} />

      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label="Game mode" className="grid grid-cols-3 gap-1 rounded-xl bg-card p-1">
          {MODES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode === key ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Difficulty">
          {[{ grid: null, label: 'All' }, ...DIFFICULTIES.map((d) => ({ grid: d.grid as number | null, label: d.label }))].map(
            (d) => (
              <button
                key={d.label}
                type="button"
                aria-pressed={grid === d.grid}
                onClick={() => setGrid(d.grid)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  grid === d.grid ? 'border-accent text-accent' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {d.label}
              </button>
            ),
          )}
          <span className="ml-auto text-xs text-muted-foreground">{MODES.find((m) => m.key === mode)?.metric}</span>
        </div>
      </div>

      <Rankings mode={mode} grid={grid} />
    </main>
  )
}

function Rankings({ mode, grid }: { mode: Mode; grid: number | null }) {
  const { api } = useSession()
  const query = `/api/leaderboard?mode=${mode}${grid ? `&grid=${grid}` : ''}`
  const { data, error } = useSWR(['leaderboard', query], () => api<Row[]>(query), {
    refreshInterval: 15_000,
    keepPreviousData: true,
  })

  if (error) return <p className="py-10 text-center text-sm text-destructive">Could not load the leaderboard.</p>
  if (!data) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-card" />
        ))}
      </div>
    )
  }
  if (!data.length) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
        <p className="font-display text-lg font-bold">No champions yet</p>
        <p className="text-sm text-muted-foreground">Finish a game in this mode to claim the top spot.</p>
      </div>
    )
  }

  const podium = data.slice(0, 3)
  const rest = data.slice(3)

  return (
    <section aria-label="Rankings" className="flex flex-col gap-3">
      <ol className="grid grid-cols-3 items-end gap-2" aria-label="Top 3">
        {[1, 0, 2].map((rank) => {
          const row = podium[rank]
          if (!row) return <li key={rank} aria-hidden />
          return <PodiumCard key={rank} rank={rank} row={row} mode={mode} />
        })}
      </ol>

      {rest.length > 0 && (
        <ol className="flex flex-col gap-2" start={4}>
          {rest.map((row, i) => (
            <li
              key={`${row.name}-${i}`}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-4 py-3',
                row.isMe ? 'border-accent bg-accent/10' : 'border-border bg-card',
              )}
            >
              <span className="w-6 shrink-0 text-center font-display text-sm font-bold text-muted-foreground tabular-nums">
                {i + 4}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {row.name}
                  {row.isMe && <span className="text-accent"> (you)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{secondaryStat(mode, row)}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-lg font-bold tabular-nums">{primaryStat(mode, row)}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{primaryUnit(mode, row)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

const PODIUM_STYLES = [
  { ring: 'ring-accent', badge: 'bg-accent text-accent-foreground', block: 'h-20 bg-accent/15 border-accent/50' },
  { ring: 'ring-muted-foreground', badge: 'bg-muted-foreground text-background', block: 'h-14 bg-card border-border' },
  { ring: 'ring-primary', badge: 'bg-primary text-primary-foreground', block: 'h-10 bg-card border-border' },
]

function PodiumCard({ rank, row, mode }: { rank: number; row: Row; mode: Mode }) {
  const style = PODIUM_STYLES[rank]
  return (
    <li className="flex min-w-0 flex-col items-center gap-2">
      <div className="relative">
        {rank === 0 && <Crown className="absolute -top-5 left-1/2 size-5 -translate-x-1/2 text-accent" aria-hidden />}
        <span
          className={cn(
            'flex items-center justify-center rounded-full bg-secondary font-display font-bold ring-2',
            rank === 0 ? 'size-16 text-xl' : 'size-12 text-base',
            style.ring,
          )}
        >
          {initials(row.name)}
        </span>
        <span
          className={cn(
            'absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full font-display text-xs font-bold',
            style.badge,
          )}
        >
          {rank + 1}
        </span>
      </div>
      <div className="w-full min-w-0 text-center">
        <p className={cn('truncate text-sm font-semibold', row.isMe && 'text-accent')}>
          {row.name}
          {row.isMe && ' (you)'}
        </p>
        <p className="font-display text-xl font-bold tabular-nums leading-tight">{primaryStat(mode, row)}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{primaryUnit(mode, row)}</p>
      </div>
      <div className={cn('w-full rounded-t-xl border border-b-0', style.block)} aria-hidden />
    </li>
  )
}

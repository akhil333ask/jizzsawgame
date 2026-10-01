'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { GameScreen } from './game-screen'
import { LeaderboardScreen } from './leaderboard-screen'
import { ApiError, SessionProvider, useSession } from './session'

function gameIdFromStartParam(param: string | null) {
  return param?.startsWith('g_') && param.length > 2 ? param.slice(2) : null
}

/** Light deterrents only - the real protection is that the server owns the solution and validates every move. */
function useInspectDeterrents() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase()
      if (
        key === 'F12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I', 'J', 'C'].includes(key)) ||
        ((e.ctrlKey || e.metaKey) && key === 'U')
      ) {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function PlayAppInner() {
  const { startParam } = useSession()
  const [gameId, setGameId] = useState(() => gameIdFromStartParam(startParam))
  useInspectDeterrents()

  if (gameId) return <GameScreen gameId={gameId} onExit={() => setGameId(null)} />
  return <LeaderboardScreen onOpenGame={setGameId} />
}

function FullScreenMessage({ title, body, pulse }: { title: string; body?: string; pulse?: boolean }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <div className={cn('size-14 rounded-full border-4 border-foreground bg-primary', pulse && 'animate-pulse')} aria-hidden>
        <div className="mt-[22px] h-1 w-full bg-foreground" />
      </div>
      <h1 className="font-display text-xl font-bold">{title}</h1>
      {body && <p className="max-w-xs text-sm text-muted-foreground text-pretty">{body}</p>}
    </main>
  )
}

export function PlayApp() {
  return (
    <SessionProvider
      fallback={<FullScreenMessage title="Connecting to Telegram..." pulse />}
      errorView={(error: ApiError) => (
        <FullScreenMessage
          title={error.code === 'telegram_required' ? 'Open this game in Telegram' : 'Sign-in failed'}
          body={
            error.code === 'telegram_required'
              ? 'Puzzle Arena runs as a Telegram Mini App. Open it from the bot so we can verify your account.'
              : 'We could not verify your Telegram session. Close and reopen the Mini App.'
          }
        />
      )}
    >
      <PlayAppInner />
    </SessionProvider>
  )
}

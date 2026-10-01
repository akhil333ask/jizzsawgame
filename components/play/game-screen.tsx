'use client'

import { ArrowLeft, Check, Clock, Crown, Grid3x3, Hourglass, Loader2, Play, Share2, ShieldAlert, Timer, Trophy, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import useSWR, { preload } from 'swr'
import { Button } from '@/components/ui/button'
import type { GameState } from '@/lib/game/engine'
import { MIN_BATTLE_PLAYERS, difficultyFor, formatDuration } from '@/lib/game/rules'
import { artworkUrl, formatDex } from '@/lib/pokemon'
import { cn } from '@/lib/utils'
import { BrandHero, BrandWordmark } from './brand-logo'
import { useMusicScene } from './music'
import { MusicToggle } from './music-toggle'
import { PuzzleBoard, loadSheet, sheetKey } from './puzzle-board'
import { unlockAudio } from './sounds'
import { ApiError, getWebApp, useSession } from './session'
import { useServerClock } from './use-server-clock'

type StateWithTime = GameState & { receivedAt: number }

// Must be a stable reference: SWR restarts its poll timer whenever this option changes identity.
const pollInterval = (d?: StateWithTime) =>
  d && (d.game.status === 'finished' || d.game.status === 'aborted') ? 0 : 1000

const MOVE_ERRORS: Record<string, string> = {
  too_fast: 'Slow down - moves are rate limited.',
  slot_taken: 'That spot is already filled.',
  disqualified: 'Your session was disqualified by anti-cheat.',
  not_started: 'Hold on, the puzzle has not started yet.',
}

const LOAD_ERRORS: Record<string, string> = {
  not_found: 'This game does not exist anymore.',
  private_game: 'This solo puzzle belongs to someone else. Send /easy, /medium or /hard in the group to get your own.',
}

const modeLabel = (mode: GameState['game']['mode']) =>
  mode === 'solo' ? 'Solo' : mode === 'multi' ? 'Multiplayer' : '1v1 duel'

export function GameScreen({ gameId, onExit }: { gameId: string; onExit: () => void }) {
  const { api, fetchBlob, user } = useSession()
  const [notice, setNotice] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const autoJoined = useRef(false)

  const { data, error, mutate } = useSWR<StateWithTime>(
    ['game-state', gameId],
    async () => ({ ...(await api<GameState>(`/api/games/${gameId}`)), receivedAt: Date.now() }),
    { refreshInterval: pollInterval, revalidateOnFocus: true },
  )
  const now = useServerClock(data?.serverNow, data?.receivedAt)

  function flash(message: string) {
    setNotice(message)
    setTimeout(() => setNotice((m) => (m === message ? null : m)), 3000)
  }

  const inLobby = data?.game.status === 'lobby'
  useMusicScene(inLobby ? 'intro' : data?.game.status === 'active' ? 'play' : null)
  // Opening a lobby link joins you and marks you as "in the game" so duels can start a shared countdown.
  const needsJoin = inLobby && data.game.mode !== 'solo' && !data.me.ready

  useEffect(() => {
    if (!needsJoin || autoJoined.current) return
    autoJoined.current = true
    api(`/api/games/${gameId}/join`, { method: 'POST' })
      .then(() => mutate())
      .catch((e) => {
        const code = e instanceof ApiError ? e.code : ''
        flash(code === 'lobby_full' ? 'This lobby is full.' : code === 'lobby_closed' ? 'This lobby is closed.' : 'Could not join this game.')
      })
  }, [needsJoin, api, gameId, mutate])

  // Start downloading the pieces the instant the game is live, before the board even mounts.
  const isActive = data?.game.status === 'active' && data.me.joined
  useEffect(() => {
    if (isActive) void preload(sheetKey(gameId), () => loadSheet(fetchBlob, gameId)).catch(() => {})
  }, [isActive, gameId, fetchBlob])

  async function startGame() {
    setStarting(true)
    try {
      unlockAudio()
      await api(`/api/games/${gameId}/start`, { method: 'POST' })
      void preload(sheetKey(gameId), () => loadSheet(fetchBlob, gameId)).catch(() => {})
      await mutate()
    } catch (e) {
      flash(e instanceof ApiError && e.code === 'not_enough_players' ? `You need at least ${MIN_BATTLE_PLAYERS} players.` : 'Could not start the game.')
    } finally {
      setStarting(false)
    }
  }

  function share() {
    if (!data) return
    const text = 'Join my Pokemon puzzle lobby!'
    const url = `https://t.me/share/url?url=${encodeURIComponent(data.inviteLink)}&text=${encodeURIComponent(text)}`
    const app = getWebApp()
    if (app?.openTelegramLink) app.openTelegramLink(url)
    else void navigator.clipboard?.writeText(data.inviteLink).then(() => flash('Invite link copied.'))
  }

  if (error) {
    const code = error instanceof ApiError ? error.code : ''
    return (
      <ScreenShell onExit={onExit} title="Game unavailable">
        <ResultCard tone="muted" heading="Can't open this game" body={LOAD_ERRORS[code] ?? 'Could not load this game.'} />
      </ScreenShell>
    )
  }
  if (!data) {
    return (
      <ScreenShell onExit={onExit} title="Loading">
        <div className="aspect-square w-full animate-pulse rounded-2xl bg-card" />
      </ScreenShell>
    )
  }

  const { game, players, me } = data
  const diff = difficultyFor(game.grid)
  const total = game.grid * game.grid
  const started = game.startsAt !== null && now >= game.startsAt
  const title = game.pokemon ? `${formatDex(game.pokemon.id)} ${game.pokemon.name}` : 'Mystery Pokemon'
  const subtitle = `${modeLabel(game.mode)} - ${diff.label} ${game.grid}x${game.grid}`
  const isHost = game.hostId === user.id

  if (game.status === 'lobby') {
    if (game.mode === 'solo') {
      return (
        <ScreenShell onExit={onExit} title="Solo puzzle" subtitle={subtitle}>
          <BrandHero priority className="-mt-2" />
          <section aria-labelledby="intro-heading" className="-mt-6 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="text-center">
              <h2 id="intro-heading" className="font-display text-2xl font-bold text-balance">
                Who&apos;s that Pokemon?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground text-pretty">
                A mystery Pokemon is hidden in this puzzle. Piece it together before the clock runs out.
              </p>
            </div>
            <ul className="grid grid-cols-3 gap-2">
              <IntroStat icon={Grid3x3} label="Board" value={`${game.grid}×${game.grid}`} />
              <IntroStat icon={Hourglass} label="Pieces" value={String(total)} />
              <IntroStat icon={Timer} label="Time" value={formatDuration(diff.timeLimitMs)} />
            </ul>
            <p className="text-center text-xs text-muted-foreground text-pretty">
              The clock only starts when you tap Start. Faster solves with fewer drops score higher.
            </p>
            <Button size="lg" className="h-14 text-lg font-bold" onClick={startGame} disabled={starting || !isHost}>
              {starting ? <Loader2 className="animate-spin" /> : <Play />}
              {starting ? 'Starting...' : 'Start'}
            </Button>
          </section>
          {notice && <Notice>{notice}</Notice>}
        </ScreenShell>
      )
    }

    const remaining = game.lobbyDeadline ? game.lobbyDeadline - now : 0
    const isMulti = game.mode === 'multi'
    const matched = !isMulti && players.length >= game.maxPlayers
    const slots = isMulti ? Math.max(players.length, MIN_BATTLE_PLAYERS) : game.maxPlayers
    return (
      <ScreenShell onExit={onExit} title={isMulti ? 'Multiplayer lobby' : '1v1 duel'} subtitle={subtitle}>
        <LobbyBanner
          label={isMulti ? 'Waiting room' : matched ? 'Duel matched!' : 'Waiting for a challenger'}
          detail={
            isMulti
              ? `Lobby closes in ${formatDuration(remaining)} if the host doesn't start.`
              : matched
                ? `The countdown starts for both of you once you're both in. Auto-start in ${formatDuration(remaining)}.`
                : `${formatDuration(remaining)} left to accept`
          }
        />

        <section aria-labelledby="lobby-players" className="flex flex-col gap-2">
          <h2 id="lobby-players" className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4" /> Players {players.length}/{game.maxPlayers}
          </h2>
          <ul className="flex flex-col gap-2">
            {Array.from({ length: slots }, (_, i) => {
              const p = players[i]
              return (
                <li
                  key={p?.id ?? `empty-${i}`}
                  className={cn(
                    'flex items-center justify-between rounded-xl border px-4 py-3 text-sm',
                    p ? 'border-border bg-secondary' : 'border-dashed border-border text-muted-foreground',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {p?.id === game.hostId && <Crown className="size-4 shrink-0 text-accent" aria-label="Host" />}
                    <span className="truncate">{p ? p.name : 'Waiting for trainer...'}</span>
                    {p?.isMe && <span className="text-xs text-accent">(you)</span>}
                  </span>
                  {p && !isMulti && (
                    p.ready ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-success">
                        <Check className="size-3.5" aria-hidden /> In game
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Opening...
                      </span>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <div className="flex flex-col gap-2">
          {isMulti && isHost && (
            <Button
              size="lg"
              className="h-12 text-base"
              onClick={startGame}
              disabled={starting || players.length < MIN_BATTLE_PLAYERS}
            >
              <Play /> {starting ? 'Starting...' : players.length < MIN_BATTLE_PLAYERS ? 'Waiting for players...' : `Start game (${players.length})`}
            </Button>
          )}
          {isMulti && !isHost && me.joined && (
            <p className="rounded-xl bg-secondary px-4 py-3 text-center text-sm text-muted-foreground">
              {"You're in! Waiting for the host to start the game."}
            </p>
          )}
          {!isMulti && (
            <p className="rounded-xl bg-secondary px-4 py-3 text-center text-sm text-muted-foreground text-pretty">
              {matched
                ? 'Keep this screen open. Both of you get the exact same countdown, no matter who opened first.'
                : isHost
                  ? 'Your challenge is live in the group. Waiting for someone to accept.'
                  : 'Joining the duel...'}
            </p>
          )}
          {isMulti && (
            <Button size="lg" variant="secondary" className="h-12 text-base" onClick={share}>
              <Share2 /> Invite friends
            </Button>
          )}
        </div>
        {notice && <Notice>{notice}</Notice>}
      </ScreenShell>
    )
  }

  if (game.status === 'aborted') {
    return (
      <ScreenShell onExit={onExit} title={title} subtitle={subtitle}>
        <ResultCard
          tone="muted"
          heading={game.mode === 'solo' ? 'Puzzle abandoned' : 'Game aborted'}
          body={
            game.mode === 'duel' || game.mode === 'battle'
              ? 'Nobody accepted the challenge in time. Start a new one from the group.'
              : 'This game was cancelled. Start a new one from the group with /easy, /medium or /hard.'
          }
        />
        <Button size="lg" className="h-12" onClick={onExit}>Back</Button>
      </ScreenShell>
    )
  }

  const timeLeft = game.endsAt ? game.endsAt - now : 0
  const isFinished = game.status === 'finished'
  const winner = players.find((p) => p.id === game.winnerId)
  const iWon = game.winnerId === user.id

  return (
    <ScreenShell onExit={onExit} title={title} subtitle={subtitle}>
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          <span
            className={cn(
              'font-display text-2xl font-bold tabular-nums',
              timeLeft < 30_000 && !isFinished ? 'text-primary' : 'text-foreground',
            )}
            aria-label="Time remaining"
          >
            {started ? formatDuration(isFinished ? 0 : timeLeft) : formatDuration(diff.timeLimitMs)}
          </span>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>{me.correctSlots.length}/{total} placed</p>
          <p>{me.moves} moves</p>
        </div>
      </div>

      {!me.joined ? (
        <ResultCard tone="muted" heading="Spectating" body="This game already started. You can watch the progress below." />
      ) : me.flagged ? (
        <ResultCard
          tone="danger"
          heading="Out of the game"
          body="You fled, or anti-cheat detected automated or impossible input. This result does not count."
        />
      ) : started && (isFinished || me.finished) ? (
        <ResultCard
          tone={iWon || (game.mode === 'solo' && me.finished) ? 'success' : 'muted'}
          heading={
            game.mode === 'solo'
              ? me.finished
                ? 'Puzzle solved!'
                : "Time's up!"
              : iWon
                ? 'You won!'
                : winner
                  ? `${winner.name} wins!`
                  : "Time's up!"
          }
          body={
            me.solveMs
              ? `Solved in ${formatDuration(me.solveMs)} with ${me.moves} moves.`
              : game.mode === 'solo'
                ? 'You ran out of time. Try again from the group.'
                : 'Better luck next round.'
          }
          score={me.score}
        />
      ) : me.board ? (
        // The board mounts during the countdown so the piece sheet is downloaded and cut before it hits zero.
        <div className="relative">
          <PuzzleBoard
            key={gameId}
            gameId={gameId}
            grid={game.grid}
            initialBoard={me.board}
            disabled={isFinished || !started}
            onMoved={(r) => {
              if (r.placed) void mutate()
            }}
            onError={(e) => {
              if (MOVE_ERRORS[e.code]) flash(MOVE_ERRORS[e.code])
              if (['conflict', 'disqualified', 'not_active', 'already_finished', 'piece_placed'].includes(e.code)) void mutate()
            }}
          />
          {!started && <CountdownOverlay seconds={Math.max(1, Math.ceil(((game.startsAt ?? now) - now) / 1000))} />}
        </div>
      ) : !started ? (
        <div className="relative aspect-square w-full rounded-2xl border-2 border-border bg-card">
          <CountdownOverlay seconds={Math.max(1, Math.ceil(((game.startsAt ?? now) - now) / 1000))} />
        </div>
      ) : (
        <div className="aspect-square w-full animate-pulse rounded-2xl bg-card" />
      )}

      {notice && <Notice>{notice}</Notice>}

      {game.pokemon && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <img
            src={artworkUrl(game.pokemon.id)}
            alt={`${game.pokemon.name} reference`}
            className="size-16 shrink-0 rounded-lg bg-secondary object-contain"
            draggable={false}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Reference image. Drop a piece near its spot - it clicks and glows if it fits. Wrong pieces stay where you left them; drag them back to the tray. Every drop is verified on the server.
          </p>
        </div>
      )}

      {game.mode !== 'solo' && (
        <section aria-labelledby="progress-heading" className="flex flex-col gap-2">
          <h2 id="progress-heading" className="text-sm font-semibold">Race progress</h2>
          <ul className="flex flex-col gap-2">
            {players
              .toSorted((a, b) => b.correct - a.correct)
              .map((p) => (
                <li key={p.id} className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className={cn('flex items-center gap-1.5', p.isMe && 'font-semibold text-accent')}>
                      {p.id === game.winnerId && <Trophy className="size-4 text-accent" aria-label="Winner" />}
                      {p.flagged && <ShieldAlert className="size-4 text-destructive" aria-label={p.fled ? 'Fled' : 'Disqualified'} />}
                      {p.name}
                      {p.isMe && ' (you)'}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {p.fled ? 'fled' : p.score !== null ? `score ${p.score}` : `${Math.round((p.correct / total) * 100)}%`}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
                    <div
                      className={cn('h-full rounded-full transition-all', p.flagged ? 'bg-destructive' : 'bg-success')}
                      style={{ width: `${(p.correct / total) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
          </ul>
        </section>
      )}

      {(isFinished || (game.mode === 'solo' && me.finished)) && (
        <Button size="lg" className="h-12 text-base" onClick={onExit}>
          <Trophy /> View leaderboard
        </Button>
      )}
    </ScreenShell>
  )
}

function LobbyBanner({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 overflow-hidden rounded-2xl border border-border bg-card pb-5 text-center">
      <BrandHero priority className="max-w-64" />
      <div className="-mt-6 px-5">
        <p className="font-display text-xl font-bold">{label}</p>
        {detail && <p className="mt-1 text-sm tabular-nums text-muted-foreground text-pretty">{detail}</p>}
        <p className="mt-2 text-xs text-muted-foreground">The Pokemon is revealed when the puzzle starts.</p>
      </div>
    </div>
  )
}

function IntroStat({ icon: Icon, label, value }: { icon: typeof Timer; label: string; value: string }) {
  return (
    <li className="flex flex-col items-center gap-1 rounded-xl bg-secondary px-2 py-3">
      <Icon className="size-4 text-accent" aria-hidden />
      <span className="font-display text-lg font-bold tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </li>
  )
}

function CountdownOverlay({ seconds }: { seconds: number }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-2xl bg-background/85 backdrop-blur-md">
      <BrandWordmark className="max-w-48" />
      <p className="text-sm uppercase tracking-widest text-muted-foreground">Get ready</p>
      <p key={seconds} className="font-display text-8xl font-bold tabular-nums text-accent animate-in zoom-in-50 fade-in duration-300" aria-live="assertive">
        {seconds}
      </p>
    </div>
  )
}

function ScreenShell({
  title,
  subtitle,
  onExit,
  children,
}: {
  title: string
  subtitle?: string
  onExit: () => void
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 px-4 pb-10 pt-4">
      <header className="flex items-center gap-3">
        <Button variant="ghost" size="icon-lg" onClick={onExit}>
          <ArrowLeft />
          <span className="sr-only">Back</span>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-bold">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <MusicToggle className="ml-auto" />
      </header>
      {children}
    </main>
  )
}

function ResultCard({
  heading,
  body,
  tone,
  score,
}: {
  heading: string
  body: string
  tone: 'success' | 'muted' | 'danger'
  score?: number | null
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-2xl border-2 p-8 text-center',
        tone === 'success' && 'border-success bg-success/10',
        tone === 'muted' && 'border-border bg-card',
        tone === 'danger' && 'border-destructive bg-destructive/10',
      )}
    >
      <p className="font-display text-2xl font-bold text-balance">{heading}</p>
      {typeof score === 'number' && (
        <p className="font-display text-6xl font-bold tabular-nums text-accent">
          {score}
          <span className="ml-1 text-base font-medium text-muted-foreground">/ 100</span>
        </p>
      )}
      <p className="text-sm text-muted-foreground text-pretty">{body}</p>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="rounded-lg bg-secondary px-3 py-2 text-center text-sm">
      {children}
    </p>
  )
}

'use client'

import { Maximize2, Minus, Plus } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent,
  type WheelEvent,
} from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { PIECE_PAD, SNAP_RADIUS } from '@/lib/game/rules'
import { cn } from '@/lib/utils'
import { ApiError, haptic, useSession } from './session'
import { playSnap, playWin, unlockAudio } from './sounds'

export type MoveResult = {
  placed: boolean
  board: number[]
  correctSlots: number[]
  moves: number
  solved: boolean
  won: boolean
}

/** Top-left corner of a piece's tile square, in tile units relative to the board. */
type Pos = { x: number; y: number; z: number }
type Drag = { pointerId: number; piece: number; x: number; y: number; fx: number; fy: number; tilePx: number }
type Candidate = { pointerId: number; piece: number; startX: number; startY: number; mouse: boolean; rect: DOMRect }

const SPAN = 1 + 2 * PIECE_PAD
const TRAY_TILE = 64
const MIN_GAP_MS = 140
const MIN_ZOOM = 1
const MAX_ZOOM = 3
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const sheetKey = (gameId: string) => ['puzzle-sheet', gameId] as const

/** Downloads and decodes the piece sheet so the first paint after the countdown needs no extra work. */
export async function loadSheet(fetchBlob: (path: string) => Promise<Blob>, gameId: string) {
  const url = URL.createObjectURL(await fetchBlob(`/api/games/${gameId}/sheet`))
  const img = new Image()
  img.src = url
  await img.decode().catch(() => {})
  return url
}

function sheetStyle(url: string, piece: number, grid: number): CSSProperties {
  const denom = Math.max(1, grid - 1)
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${grid * 100}% ${grid * 100}%`,
    backgroundPosition: `${((piece % grid) / denom) * 100}% ${(Math.floor(piece / grid) / denom) * 100}%`,
    backgroundRepeat: 'no-repeat',
  }
}

function boardStyle(x: number, y: number, grid: number): CSSProperties {
  return {
    left: `${((x - PIECE_PAD) / grid) * 100}%`,
    top: `${((y - PIECE_PAD) / grid) * 100}%`,
    width: `${(SPAN / grid) * 100}%`,
    height: `${(SPAN / grid) * 100}%`,
  }
}

/** Where inside the tile square (0..1) the pointer grabbed a piece element that includes the knob padding. */
function grabFraction(rect: DOMRect, clientX: number, clientY: number) {
  return {
    fx: clamp(((clientX - rect.left) / rect.width) * SPAN - PIECE_PAD, 0, 1),
    fy: clamp(((clientY - rect.top) / rect.height) * SPAN - PIECE_PAD, 0, 1),
  }
}

export function PuzzleBoard({
  gameId,
  grid,
  initialBoard,
  disabled,
  onMoved,
  onError,
}: {
  gameId: string
  grid: number
  initialBoard: number[]
  disabled: boolean
  onMoved: (result: MoveResult) => void
  onError: (error: ApiError) => void
}) {
  const { api, fetchBlob } = useSession()
  const n = grid * grid

  const [board, setBoard] = useState(initialBoard)
  const [loose, setLoose] = useState<Record<number, Pos>>({})
  const [drags, setDrags] = useState<Drag[]>([])
  const [pending, setPending] = useState<Set<number>>(() => new Set())
  const [glow, setGlow] = useState<Set<number>>(() => new Set())
  const [zoom, setZoom] = useState(1)

  const boardRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const boardState = useRef(initialBoard)
  const dragMap = useRef(new Map<number, Drag>())
  const candidates = useRef(new Map<number, Candidate>())
  const queue = useRef<Promise<void>>(Promise.resolve())
  const lastSend = useRef(0)
  const zTop = useRef(1)
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)

  const { data: sheetUrl, error: sheetError } = useSWR(sheetKey(gameId), () => loadSheet(fetchBlob, gameId), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
  })

  useEffect(() => {
    return () => {
      if (sheetUrl) URL.revokeObjectURL(sheetUrl)
    }
  }, [sheetUrl])

  function flashSet(setter: typeof setGlow, pieces: number[], ms: number) {
    setter((s) => new Set([...s, ...pieces]))
    setTimeout(() => setter((s) => new Set([...s].filter((p) => !pieces.includes(p)))), ms)
  }

  function syncDrags() {
    setDrags(Array.from(dragMap.current.values()))
  }

  function beginDrag(piece: number, pointerId: number, clientX: number, clientY: number, fx: number, fy: number) {
    const rect = boardRef.current?.getBoundingClientRect()
    if (!rect) return
    dragMap.current.set(pointerId, { pointerId, piece, x: clientX, y: clientY, fx, fy, tilePx: rect.width / grid })
    setLoose((l) => {
      if (!(piece in l)) return l
      const next = { ...l }
      delete next[piece]
      return next
    })
    haptic('tap')
    syncDrags()
  }

  function neighbourPieces(slot: number, nextBoard: number[]) {
    const r = Math.floor(slot / grid)
    const c = slot % grid
    const around = [
      r > 0 ? slot - grid : -1,
      r < grid - 1 ? slot + grid : -1,
      c > 0 ? slot - 1 : -1,
      c < grid - 1 ? slot + 1 : -1,
    ]
    return around.filter((s) => s >= 0 && nextBoard[s] >= 0).map((s) => nextBoard[s])
  }

  function attempt(piece: number, slot: number) {
    setPending((s) => new Set(s).add(piece))
    queue.current = queue.current.then(async () => {
      const wait = lastSend.current + MIN_GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      lastSend.current = Date.now()
      try {
        const result = await api<MoveResult>(`/api/games/${gameId}/move`, {
          method: 'POST',
          body: JSON.stringify({ piece, slot }),
        })
        boardState.current = result.board
        setBoard(result.board)
        if (result.placed) {
          setLoose((l) => {
            const next = { ...l }
            delete next[piece]
            return next
          })
          flashSet(setGlow, [piece, ...neighbourPieces(slot, result.board)], 900)
          playSnap()
          haptic('success')
          if (result.solved) setTimeout(playWin, 250)
        }
        onMoved(result)
      } catch (error) {
        haptic('error')
        onError(error instanceof ApiError ? error : new ApiError('request_failed', 500))
      } finally {
        setPending((s) => {
          const next = new Set(s)
          next.delete(piece)
          return next
        })
      }
    })
  }

  function drop(d: Drag) {
    const boardRect = boardRef.current?.getBoundingClientRect()
    const viewRect = viewportRef.current?.getBoundingClientRect()
    if (!boardRect || !viewRect) return
    const overViewport =
      d.x >= viewRect.left && d.x <= viewRect.right && d.y >= viewRect.top && d.y <= viewRect.bottom
    if (!overViewport) return

    const tilePx = boardRect.width / grid
    const u = (d.x - d.fx * tilePx - boardRect.left) / tilePx
    const v = (d.y - d.fy * tilePx - boardRect.top) / tilePx
    const x = clamp(u, 0, grid - 1)
    const y = clamp(v, 0, grid - 1)
    setLoose((l) => ({ ...l, [d.piece]: { x, y, z: ++zTop.current } }))

    const c = Math.round(u)
    const r = Math.round(v)
    const slot = r * grid + c
    const nearSlot = c >= 0 && r >= 0 && c < grid && r < grid && Math.hypot(u - c, v - r) <= SNAP_RADIUS
    if (nearSlot && boardState.current[slot] === -1) attempt(d.piece, slot)
  }

  const handlers = useRef({ move: (_e: PointerEvent) => {}, end: (_e: PointerEvent, _cancel: boolean) => {} })
  handlers.current.move = (e) => {
    const c = candidates.current.get(e.pointerId)
    if (c) {
      const dx = e.clientX - c.startX
      const dy = e.clientY - c.startY
      const start = c.mouse ? Math.hypot(dx, dy) > 6 : Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)
      if (start) {
        candidates.current.delete(e.pointerId)
        const { fx, fy } = grabFraction(c.rect, c.startX, c.startY)
        beginDrag(c.piece, e.pointerId, e.clientX, e.clientY, fx, fy)
      }
      return
    }
    const d = dragMap.current.get(e.pointerId)
    if (!d) return
    d.x = e.clientX
    d.y = e.clientY
    syncDrags()
  }
  handlers.current.end = (e) => {
    candidates.current.delete(e.pointerId)
    const d = dragMap.current.get(e.pointerId)
    if (!d) return
    dragMap.current.delete(e.pointerId)
    drop(d)
    syncDrags()
  }

  useEffect(() => {
    const move = (e: PointerEvent) => handlers.current.move(e)
    const up = (e: PointerEvent) => handlers.current.end(e, false)
    const cancel = (e: PointerEvent) => handlers.current.end(e, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [])

  function onTrayPointerDown(piece: number, e: ReactPointerEvent<HTMLDivElement>) {
    unlockAudio()
    if (disabled) return
    if (e.pointerType === 'mouse') e.preventDefault()
    candidates.current.set(e.pointerId, {
      pointerId: e.pointerId,
      piece,
      startX: e.clientX,
      startY: e.clientY,
      mouse: e.pointerType === 'mouse',
      rect: e.currentTarget.getBoundingClientRect(),
    })
  }

  function onLoosePointerDown(piece: number, e: ReactPointerEvent<HTMLDivElement>) {
    unlockAudio()
    if (disabled || pending.has(piece)) return
    e.preventDefault()
    e.stopPropagation()
    const { fx, fy } = grabFraction(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)
    beginDrag(piece, e.pointerId, e.clientX, e.clientY, fx, fy)
  }

  function touchDistance(e: TouchEvent) {
    const [t1, t2] = [e.touches[0], e.touches[1]]
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
  }
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2 && dragMap.current.size === 0) pinch.current = { distance: touchDistance(e), zoom }
  }
  function onTouchMove(e: TouchEvent) {
    if (e.touches.length === 2 && pinch.current && dragMap.current.size === 0) {
      setZoom(clampZoom(pinch.current.zoom * (touchDistance(e) / pinch.current.distance)))
    }
  }
  function onBoardWheel(e: WheelEvent) {
    if (!e.ctrlKey) return
    setZoom((z) => clampZoom(z - e.deltaY * 0.01))
  }
  function onTrayWheel(e: WheelEvent<HTMLDivElement>) {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
  }

  const placed = new Set(board.filter((p) => p >= 0))
  const dragging = new Set(drags.map((d) => d.piece))
  const trayPieces = Array.from({ length: n }, (_, p) => p).filter(
    (p) => !placed.has(p) && !(p in loose) && !dragging.has(p),
  )
  const looseEntries = Object.entries(loose)
    .map(([p, pos]) => ({ piece: Number(p), ...pos }))
    .filter((l) => !placed.has(l.piece))
    .sort((a, b) => a.z - b.z)

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={viewportRef}
        className="no-callout relative aspect-square w-full overflow-auto rounded-2xl border-2 border-border bg-card [touch-action:pan-x_pan-y]"
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={() => (pinch.current = null)}
        onWheel={onBoardWheel}
      >
        {!sheetUrl && !sheetError && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Cutting puzzle pieces...
          </div>
        )}
        {sheetError && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-destructive">
            Could not load the puzzle image. Close and reopen the game to try again.
          </div>
        )}
        <div
          ref={boardRef}
          role="img"
          aria-label={`Jigsaw board, ${placed.size} of ${n} pieces placed`}
          className="relative aspect-square origin-top-left transition-[width] duration-150"
          style={{ width: `${zoom * 100}%` }}
        >
          <div
            aria-hidden
            className="absolute inset-0 grid"
            style={{ gridTemplateColumns: `repeat(${grid}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: n }, (_, slot) => (
              <div key={slot} className="border border-dashed border-foreground/10 bg-secondary/30" />
            ))}
          </div>

          {sheetUrl &&
            board.map((piece, slot) =>
              piece < 0 ? null : (
                <div
                  key={`placed-${piece}`}
                  aria-hidden
                  className={cn('piece-placed pointer-events-none absolute', glow.has(piece) && 'piece-glow')}
                  style={{ ...boardStyle(slot % grid, Math.floor(slot / grid), grid), ...sheetStyle(sheetUrl, piece, grid) }}
                />
              ),
            )}

          {sheetUrl &&
            looseEntries.map(({ piece, x, y, z }) => (
              <div
                key={`loose-${piece}`}
                role="img"
                aria-label="Loose puzzle piece"
                onPointerDown={(e) => onLoosePointerDown(piece, e)}
                className={cn(
                  'piece absolute [touch-action:none]',
                  pending.has(piece) ? 'pointer-events-none opacity-80' : 'cursor-grab',
                )}
                style={{ ...boardStyle(x, y, grid), ...sheetStyle(sheetUrl, piece, grid), zIndex: z }}
              />
            ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {trayPieces.length > 0
            ? `${trayPieces.length} pieces left - drag them up onto the board`
            : placed.size < n
              ? 'Drag the loose pieces into their spots'
              : 'All pieces placed!'}
        </p>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom controls">
          <Button variant="secondary" size="icon-sm" onClick={() => setZoom((z) => clampZoom(z - 0.25))} disabled={zoom <= MIN_ZOOM}>
            <Minus />
            <span className="sr-only">Zoom out</span>
          </Button>
          <span className="w-10 text-center font-mono text-xs tabular-nums" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="secondary" size="icon-sm" onClick={() => setZoom((z) => clampZoom(z + 0.25))} disabled={zoom >= MAX_ZOOM}>
            <Plus />
            <span className="sr-only">Zoom in</span>
          </Button>
          <Button variant="secondary" size="icon-sm" onClick={() => setZoom(1)} disabled={zoom === 1}>
            <Maximize2 />
            <span className="sr-only">Reset zoom</span>
          </Button>
        </div>
      </div>

      <div
        role="list"
        aria-label="Puzzle pieces tray. Scroll sideways, drag a piece up to place it."
        onWheel={onTrayWheel}
        className="no-callout scrollbar-none flex min-h-28 items-center gap-2 overflow-x-auto rounded-2xl border border-border bg-secondary/60 px-4 py-1 [touch-action:pan-x]"
        onContextMenu={(e) => e.preventDefault()}
      >
        {sheetUrl &&
          trayPieces.map((piece) => (
            <div
              key={piece}
              role="listitem"
              aria-label="Puzzle piece"
              onPointerDown={(e) => onTrayPointerDown(piece, e)}
              className={cn('piece shrink-0 cursor-grab', disabled && 'opacity-50')}
              style={{
                width: TRAY_TILE * SPAN,
                height: TRAY_TILE * SPAN,
                marginInline: -TRAY_TILE * PIECE_PAD * 0.4,
                ...sheetStyle(sheetUrl, piece, grid),
              }}
            />
          ))}
        {sheetUrl && trayPieces.length === 0 && (
          <p className="w-full text-center text-xs text-muted-foreground">Tray empty</p>
        )}
      </div>

      {sheetUrl &&
        drags.map((d) => (
          <div
            key={`drag-${d.pointerId}`}
            aria-hidden
            className="piece-lifted pointer-events-none fixed z-50 scale-105"
            style={{
              left: d.x - (d.fx + PIECE_PAD) * d.tilePx,
              top: d.y - (d.fy + PIECE_PAD) * d.tilePx,
              width: d.tilePx * SPAN,
              height: d.tilePx * SPAN,
              ...sheetStyle(sheetUrl, d.piece, grid),
            }}
          />
        ))}
    </div>
  )
}

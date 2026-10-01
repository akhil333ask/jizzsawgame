export const SOLO_COUNTDOWN_MS = 3_000
/** Duels only start once both players have the Mini App open, so everyone sees the same countdown. */
export const DUEL_COUNTDOWN_MS = 5_000
/** After a duel is accepted, how long to wait for both players to open the game before starting anyway. */
export const DUEL_READY_MS = 45_000
/** Multiplayer players are already waiting inside the Mini App. */
export const MULTI_COUNTDOWN_MS = 5_000

export const DUEL_LOBBY_MS = 60_000
export const MULTI_LOBBY_MS = 10 * 60_000
/** Solo puzzles posted in a group must be opened within this window. */
export const SOLO_EXPIRY_MS = 30 * 60_000
/** How often the 1v1 countdown message is re-edited. Telegram allows ~20 group messages per minute. */
export const COUNTDOWN_TICK_MS = 5_000

export const MIN_BATTLE_PLAYERS = 2
export const MULTI_MAX_PLAYERS = 10

export const DIFFICULTIES = [
  { grid: 3, key: 'easy', label: 'Easy', timeLimitMs: 120_000 },
  { grid: 4, key: 'medium', label: 'Medium', timeLimitMs: 240_000 },
  { grid: 5, key: 'hard', label: 'Hard', timeLimitMs: 420_000 },
] as const

export type Grid = (typeof DIFFICULTIES)[number]['grid']

export function isGrid(value: unknown): value is Grid {
  return value === 3 || value === 4 || value === 5
}

export function difficultyFor(grid: number) {
  return DIFFICULTIES.find((d) => d.grid === grid) ?? DIFFICULTIES[1]
}

export function parseDifficulty(word: string | undefined): Grid | undefined {
  if (!word) return undefined
  const w = word.toLowerCase()
  if (w === 'easy' || w === '3x3' || w === '3') return 3
  if (w === 'medium' || w === 'normal' || w === '4x4' || w === '4') return 4
  if (w === 'hard' || w === '5x5' || w === '5') return 5
  return undefined
}

/** 1-100. Speed is worth 70 points (time left vs. the limit), accuracy 30 (pieces / drops). */
export function computeScore(grid: number, solveMs: number, moves: number) {
  const pieces = grid * grid
  const speed = Math.max(0, 1 - solveMs / difficultyFor(grid).timeLimitMs)
  const accuracy = Math.min(1, pieces / Math.max(moves, pieces))
  return Math.max(1, Math.min(100, Math.round(70 * speed + 30 * accuracy)))
}

export const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Minimum average time per piece a human can plausibly achieve. Anything faster is treated as automation. */
export const MIN_MS_PER_PIECE = 300
/** Drops closer together than this are rejected outright. */
export const MIN_MOVE_INTERVAL_MS = 100
/** Drops closer together than this count toward the burst score. */
export const BURST_INTERVAL_MS = 350
export const BURST_LIMIT = 20
/** Wrong drops allowed before a player is treated as brute-forcing positions. */
export const maxMisses = (pieces: number) => pieces * pieces + 40

/** Extra margin around every tile (as a fraction of the tile) that holds the jigsaw knobs. */
export const PIECE_PAD = 0.3
/** How close (in tiles) a dropped piece must be to a slot before it is checked for a snap. */
export const SNAP_RADIUS = 0.2

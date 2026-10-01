import { randomBytes, randomInt } from 'node:crypto'
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { after } from 'next/server'
import { db } from '../db'
import { gamePlayers, games, players, type Game, type GameMode } from '../db/schema'
import type { SessionUser } from '../auth'
import { getPokemon, randomPokemonId } from '../pokemon'
import { launchLink } from '../telegram/api'
import { notifyTelegram, type GameEvent, type RosterEntry } from '../telegram/notify'
import {
  BURST_INTERVAL_MS,
  BURST_LIMIT,
  DUEL_COUNTDOWN_MS,
  DUEL_LOBBY_MS,
  DUEL_READY_MS,
  MIN_BATTLE_PLAYERS,
  MIN_MOVE_INTERVAL_MS,
  MIN_MS_PER_PIECE,
  MULTI_COUNTDOWN_MS,
  MULTI_LOBBY_MS,
  MULTI_MAX_PLAYERS,
  SOLO_COUNTDOWN_MS,
  SOLO_EXPIRY_MS,
  computeScore,
  difficultyFor,
  isGrid,
  maxMisses,
} from './rules'
import { buildScrambledSheet, getBaseImage } from './image'

/** Runs after the response is sent so cutting the artwork never delays the request that triggered it. */
function inBackground(label: string, task: () => Promise<unknown>) {
  const run = () => task().catch((error) => console.error(`[game] ${label} failed`, error))
  try {
    after(run)
  } catch {
    void run()
  }
}

/** Cut the pieces the moment a game starts, so the sheet is cached before any client asks for it. */
function warmSheet(g: Game) {
  if (g.perm) inBackground('sheet warmup', () => buildScrambledSheet(g.id, g.pokemonId, g.grid, g.perm!))
}

export class GameError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code)
  }
}

const BATTLE_MODES: GameMode[] = ['duel', 'multi', 'battle']
export const isBattle = (mode: GameMode) => mode !== 'solo'

const newId = () => randomBytes(8).toString('base64url')
const identity = (n: number) => Array.from({ length: n }, (_, i) => i)
/** board[slot] = the piece locked into that slot, or -1 while the slot is empty. */
const emptyBoard = (n: number) => Array.from({ length: n }, () => -1)

/** perm[piece] = the correct slot of the piece drawn in scrambled sheet cell `piece`. */
function scramble(n: number) {
  const maxInOrder = Math.floor(n / 8)
  for (;;) {
    const arr = identity(n)
    for (let i = n - 1; i > 0; i--) {
      const j = randomInt(i + 1)
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    if (arr.filter((v, i) => v === i).length <= maxInOrder) return arr
  }
}

const filledSlots = (board: number[]) => board.flatMap((piece, slot) => (piece >= 0 ? [slot] : []))

const reload = async (id: string) => (await db.select().from(games).where(eq(games.id, id)))[0] ?? null

export async function upsertPlayer(user: SessionUser) {
  await db
    .insert(players)
    .values({ id: user.id, name: user.name, username: user.username })
    .onConflictDoUpdate({
      target: players.id,
      set: { name: user.name, username: user.username ?? null, updatedAt: new Date() },
    })
}

async function assertNotSpamming(hostId: number) {
  const [row] = await db
    .select({ n: count() })
    .from(games)
    .where(and(eq(games.hostId, hostId), gt(games.createdAt, new Date(Date.now() - 60_000))))
  if ((row?.n ?? 0) >= 6) throw new GameError('rate_limited', 429)
}

/** Posts a solo puzzle that only `user` can open. The clock starts when they open it, not when it is posted. */
export async function createSoloGame(opts: { user: SessionUser; grid: number; chatId: number }) {
  if (!isGrid(opts.grid)) throw new GameError('invalid_grid')
  await upsertPlayer(opts.user)
  await assertNotSpamming(opts.user.id)

  const id = newId()
  await db.transaction(async (tx) => {
    await tx.insert(games).values({
      id,
      mode: 'solo',
      status: 'lobby',
      pokemonId: randomPokemonId(),
      grid: opts.grid,
      maxPlayers: 1,
      hostId: opts.user.id,
      chatId: opts.chatId,
      lobbyDeadline: new Date(Date.now() + SOLO_EXPIRY_MS),
    })
    await tx.insert(gamePlayers).values({ gameId: id, playerId: opts.user.id })
  })
  return id
}

export async function createBattle(opts: { host: SessionUser; grid: number; mode: 'duel' | 'multi'; chatId: number }) {
  if (!isGrid(opts.grid)) throw new GameError('invalid_grid')
  await upsertPlayer(opts.host)
  await assertNotSpamming(opts.host.id)

  const id = newId()
  await db.transaction(async (tx) => {
    await tx.insert(games).values({
      id,
      mode: opts.mode,
      status: 'lobby',
      pokemonId: randomPokemonId(),
      grid: opts.grid,
      maxPlayers: opts.mode === 'duel' ? 2 : MULTI_MAX_PLAYERS,
      hostId: opts.host.id,
      chatId: opts.chatId,
      lobbyDeadline: new Date(Date.now() + (opts.mode === 'duel' ? DUEL_LOBBY_MS : MULTI_LOBBY_MS)),
    })
    await tx.insert(gamePlayers).values({ gameId: id, playerId: opts.host.id })
  })
  return id
}

export async function attachMessage(gameId: string, chatId: number, messageId: number) {
  await db.update(games).set({ chatId, messageId }).where(eq(games.id, gameId))
}

/**
 * Games the user is in that are still waiting or running. Telegram can reopen a minimized
 * Mini App without the new start_param, so the home screen offers these as a resume list.
 */
export async function listOpenGames(userId: number) {
  const rows = await db
    .select({ id: games.id, mode: games.mode, status: games.status, grid: games.grid, hostId: games.hostId, createdAt: games.createdAt })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(
      and(
        eq(gamePlayers.playerId, userId),
        isNull(gamePlayers.finishedAt),
        inArray(games.status, ['lobby', 'active']),
        gt(games.createdAt, new Date(Date.now() - 2 * 60 * 60_000)),
      ),
    )
    .orderBy(desc(games.createdAt))
    .limit(10)

  const fresh = await Promise.all(rows.map(async (row) => ({ row, game: await syncGame(row.id) })))
  return fresh
    .filter(({ game }) => game && (game.status === 'lobby' || game.status === 'active'))
    .map(({ row, game }) => ({
      id: row.id,
      mode: row.mode,
      status: game!.status,
      grid: row.grid,
      isHost: row.hostId === userId,
      createdAt: row.createdAt.toISOString(),
    }))
}

/**
 * A group can run many lobbies at once; each host only gets one. Starting a new
 * 1v1/Multiplayer replaces the host's previous waiting lobby in that chat.
 */
export async function cancelHostLobbies(chatId: number, host: SessionUser) {
  const open = await db
    .select()
    .from(games)
    .where(
      and(
        eq(games.chatId, chatId),
        eq(games.hostId, host.id),
        eq(games.status, 'lobby'),
        inArray(games.mode, BATTLE_MODES),
      ),
    )
  for (const g of open) {
    const fresh = await syncGame(g.id)
    if (fresh?.status === 'lobby') await abortGame(fresh, 'cancelled', host.name)
  }
}

/** `ready` is true when the join comes from inside the Mini App (the player is already looking at the lobby). */
export async function joinGame(gameId: string, user: SessionUser, opts: { ready?: boolean } = {}) {
  await upsertPlayer(user)
  const readyAt = opts.ready ? new Date() : null
  const result = await db.transaction(async (tx) => {
    const [g] = await tx.select().from(games).where(eq(games.id, gameId)).for('update')
    if (!g) throw new GameError('not_found', 404)

    const [existing] = await tx
      .select({ id: gamePlayers.playerId, readyAt: gamePlayers.readyAt })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, user.id)))
    if (existing) {
      const becameReady = !!readyAt && !existing.readyAt
      if (becameReady) {
        await tx
          .update(gamePlayers)
          .set({ readyAt })
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, user.id)))
      }
      return { status: 'already' as const, isHost: g.hostId === user.id, becameReady }
    }

    if (g.mode === 'solo') throw new GameError('private_game', 403)
    if (g.status !== 'lobby' || (g.lobbyDeadline && g.lobbyDeadline.getTime() <= Date.now())) {
      throw new GameError('lobby_closed', 409)
    }
    const [{ n }] = await tx.select({ n: count() }).from(gamePlayers).where(eq(gamePlayers.gameId, gameId))
    if (n >= g.maxPlayers) throw new GameError('lobby_full', 409)

    await tx.insert(gamePlayers).values({ gameId, playerId: user.id, readyAt })
    // A full duel now waits for both players to open the Mini App, with a fresh window to do so.
    if (g.mode !== 'multi' && n + 1 >= g.maxPlayers) {
      await tx.update(games).set({ lobbyDeadline: new Date(Date.now() + DUEL_READY_MS) }).where(eq(games.id, gameId))
    }
    return { status: 'joined' as const, isHost: false, becameReady: !!readyAt }
  })

  const game = await syncGame(gameId)
  const changed = result.status === 'joined' || (result.becameReady && game?.mode !== 'multi')
  if (changed && game?.status === 'lobby') await notify(game, 'lobby_update')
  return { ...result, game }
}

async function roster(gameId: string): Promise<RosterEntry[]> {
  const rows = await db
    .select({
      id: gamePlayers.playerId,
      name: players.name,
      correct: gamePlayers.correct,
      finishedAt: gamePlayers.finishedAt,
      solveMs: gamePlayers.solveMs,
      score: gamePlayers.score,
      flagged: gamePlayers.flagged,
      flagReason: gamePlayers.flagReason,
      readyAt: gamePlayers.readyAt,
    })
    .from(gamePlayers)
    .innerJoin(players, eq(players.id, gamePlayers.playerId))
    .where(eq(gamePlayers.gameId, gameId))
    .orderBy(asc(gamePlayers.joinedAt))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ready: !!r.readyAt,
    correct: r.correct,
    finished: !!r.finishedAt,
    solveMs: r.solveMs,
    score: r.score,
    flagged: r.flagged,
    fled: r.flagReason === 'fled',
  }))
}

export async function getRoster(gameId: string) {
  return roster(gameId)
}

async function notify(game: Game, event: GameEvent, extra?: { actorName?: string }) {
  try {
    await notifyTelegram(game, event, await roster(game.id), extra)
  } catch (error) {
    console.error('[game] notify failed', error)
  }
}

/** Idempotent state machine tick. Safe to call from any request; only the caller that wins a transition notifies. */
export async function syncGame(gameId: string): Promise<Game | null> {
  const g = await reload(gameId)
  if (!g) return null
  const now = Date.now()

  if (g.status === 'lobby') {
    const deadlinePassed = !!g.lobbyDeadline && now >= g.lobbyDeadline.getTime()
    if (g.mode === 'solo') return deadlinePassed ? abortGame(g, 'expired') : g

    if (g.mode === 'multi') return deadlinePassed ? abortGame(g, 'expired') : g
    const [{ n, ready }] = await db
      .select({ n: count(), ready: count(gamePlayers.readyAt) })
      .from(gamePlayers)
      .where(eq(gamePlayers.gameId, gameId))
    // A full duel starts once everyone has the game open (or the ready window runs out), so both share one countdown.
    if (n >= g.maxPlayers) return ready >= n || deadlinePassed ? startBattle(g) : g
    if (deadlinePassed) return n >= MIN_BATTLE_PLAYERS ? startBattle(g) : abortGame(g, 'expired')
    return g
  }

  if (g.status === 'active' && g.endsAt && now >= g.endsAt.getTime()) {
    const [ended] = await db
      .update(games)
      .set({ status: 'finished', finishedAt: new Date() })
      .where(and(eq(games.id, gameId), eq(games.status, 'active')))
      .returning()
    if (ended) {
      await notify(ended, 'finished')
      return ended
    }
    return reload(gameId)
  }
  return g
}

/** Solo: the owner opening the puzzle starts their clock. Multiplayer: the host presses Start. */
export async function hostStart(gameId: string, user: SessionUser) {
  const g = await syncGame(gameId)
  if (!g) throw new GameError('not_found', 404)
  if (g.hostId !== user.id) throw new GameError(g.mode === 'solo' ? 'private_game' : 'not_host', 403)
  if (g.status !== 'lobby') return g

  if (g.mode === 'solo') return startSolo(g)
  if (g.mode !== 'multi') throw new GameError('not_host_started', 409)

  const [{ n }] = await db.select({ n: count() }).from(gamePlayers).where(eq(gamePlayers.gameId, gameId))
  if (n < MIN_BATTLE_PLAYERS) throw new GameError('not_enough_players', 409)
  return startBattle(g)
}

async function startSolo(g: Game) {
  const n = g.grid * g.grid
  const startsAt = Date.now() + SOLO_COUNTDOWN_MS
  const started = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(games)
      .set({
        status: 'active',
        perm: scramble(n),
        startsAt: new Date(startsAt),
        endsAt: new Date(startsAt + difficultyFor(g.grid).timeLimitMs),
      })
      .where(and(eq(games.id, g.id), eq(games.status, 'lobby')))
      .returning()
    if (!row) return null
    await tx.update(gamePlayers).set({ board: emptyBoard(n), correct: 0 }).where(eq(gamePlayers.gameId, g.id))
    await tx.update(players).set({ games: sql`${players.games} + 1` }).where(eq(players.id, g.hostId))
    return row
  })
  if (started) warmSheet(started)
  return started ?? reload(g.id)
}

async function startBattle(g: Game) {
  const n = g.grid * g.grid
  const startsAt = Date.now() + (g.mode === 'multi' ? MULTI_COUNTDOWN_MS : DUEL_COUNTDOWN_MS)

  const started = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(games)
      .set({
        status: 'active',
        perm: scramble(n),
        startsAt: new Date(startsAt),
        endsAt: new Date(startsAt + difficultyFor(g.grid).timeLimitMs),
      })
      .where(and(eq(games.id, g.id), eq(games.status, 'lobby')))
      .returning()
    if (!row) return null
    await tx.update(gamePlayers).set({ board: emptyBoard(n), correct: 0 }).where(eq(gamePlayers.gameId, g.id))
    const ids = (await tx.select({ id: gamePlayers.playerId }).from(gamePlayers).where(eq(gamePlayers.gameId, g.id))).map(
      (r) => r.id,
    )
    if (ids.length) await tx.update(players).set({ games: sql`${players.games} + 1` }).where(inArray(players.id, ids))
    return row
  })

  if (started) {
    warmSheet(started)
    await notify(started, 'started')
    return started
  }
  return reload(g.id)
}

async function abortGame(g: Game, reason: 'expired' | 'cancelled', actorName?: string) {
  const [row] = await db
    .update(games)
    .set({ status: 'aborted', finishedAt: new Date() })
    .where(and(eq(games.id, g.id), eq(games.status, g.status)))
    .returning()
  if (row) {
    await notify(row, reason === 'expired' ? 'expired' : 'cancelled', { actorName })
    return row
  }
  return reload(g.id)
}

async function flag(gameId: string, playerId: number, reason: string) {
  await db
    .update(gamePlayers)
    .set({ flagged: true, flagReason: reason })
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)))
  console.warn(`[anticheat] flagged player ${playerId} in game ${gameId}: ${reason}`)
}

/** A drop of `piece` onto `slot`. It locks in only if it is the piece's true slot; otherwise nothing attaches. */
export async function makeMove(gameId: string, user: SessionUser, pieceInput: unknown, slotInput: unknown) {
  const g = await syncGame(gameId)
  if (!g) throw new GameError('not_found', 404)
  if (g.status !== 'active' || !g.perm || !g.startsAt) throw new GameError('not_active', 409)

  const now = Date.now()
  if (now < g.startsAt.getTime()) throw new GameError('not_started', 425)

  const n = g.grid * g.grid
  if (!Number.isInteger(pieceInput) || !Number.isInteger(slotInput)) throw new GameError('invalid_move')
  const piece = pieceInput as number
  const slot = slotInput as number
  if (piece < 0 || slot < 0 || piece >= n || slot >= n) throw new GameError('invalid_move')

  const [gp] = await db
    .select()
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, user.id)))
  if (!gp?.board) throw new GameError('not_in_game', 403)
  if (gp.flagged) throw new GameError('disqualified', 403)
  if (gp.finishedAt) throw new GameError('already_finished', 409)

  const board = [...gp.board]
  if (board.includes(piece)) throw new GameError('piece_placed', 409)
  if (board[slot] !== -1) throw new GameError('slot_taken', 409)

  const sinceLast = gp.lastMoveAt ? now - gp.lastMoveAt.getTime() : Number.POSITIVE_INFINITY
  if (sinceLast < MIN_MOVE_INTERVAL_MS) throw new GameError('too_fast', 429)
  const burst = sinceLast < BURST_INTERVAL_MS ? gp.burst + 1 : Math.max(0, gp.burst - 1)
  if (burst > BURST_LIMIT) {
    await flag(gameId, user.id, 'automated_input')
    throw new GameError('disqualified', 403)
  }

  const placed = g.perm[piece] === slot
  if (placed) board[slot] = piece
  const correct = filledSlots(board)
  const moves = gp.moves + 1
  if (moves - correct.length > maxMisses(n)) {
    await flag(gameId, user.id, 'brute_force')
    throw new GameError('disqualified', 403)
  }
  const solved = correct.length === n
  const solveMs = now - g.startsAt.getTime()
  const implausible = solved && solveMs < n * MIN_MS_PER_PIECE
  const score = solved && !implausible ? computeScore(g.grid, solveMs, moves) : null

  const [updated] = await db
    .update(gamePlayers)
    .set({
      board,
      moves,
      correct: correct.length,
      lastMoveAt: new Date(now),
      burst,
      ...(score !== null ? { finishedAt: new Date(now), solveMs, score } : {}),
      ...(implausible ? { flagged: true, flagReason: 'implausible_speed' } : {}),
    })
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, user.id), eq(gamePlayers.moves, gp.moves)))
    .returning({ moves: gamePlayers.moves })
  if (!updated) throw new GameError('conflict', 409)
  if (implausible) throw new GameError('disqualified', 403)

  let won = false
  if (score !== null) won = await recordSolve(g, user.id, solveMs, score)
  return { placed, board, correctSlots: correct, moves: updated.moves, solved, won, score }
}

async function recordSolve(g: Game, playerId: number, solveMs: number, score: number) {
  // Solo high score has to be read before this game is marked finished, or it would compare against itself.
  const previousBest = g.mode === 'solo' && g.chatId ? await groupSoloBest(g.chatId, g.grid, g.id) : null

  const [row] = await db
    .update(games)
    .set({ status: 'finished', winnerId: playerId, finishedAt: new Date() })
    .where(and(eq(games.id, g.id), eq(games.status, 'active'), isNull(games.winnerId)))
    .returning()
  if (!row) return false

  const statUpdate =
    g.mode === 'solo' ? { soloSolved: sql`${players.soloSolved} + 1` } : { wins: sql`${players.wins} + 1` }
  await db
    .update(players)
    .set({ ...statUpdate, bestMs: sql`LEAST(COALESCE(${players.bestMs}, ${solveMs}), ${solveMs})` })
    .where(eq(players.id, playerId))

  if (g.mode === 'solo') {
    await notify(row, previousBest === null || score > previousBest ? 'solo_highscore' : 'solo_done')
  } else {
    await notify(row, 'finished')
  }
  return true
}

/** Highest solo score ever posted in this chat at this difficulty, excluding one game. */
async function groupSoloBest(chatId: number, grid: number, excludeGameId: string) {
  const [row] = await db
    .select({ best: sql<number | null>`max(${gamePlayers.score})` })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(
      and(
        eq(games.chatId, chatId),
        eq(games.mode, 'solo'),
        eq(games.grid, grid),
        ne(games.id, excludeGameId),
        isNotNull(gamePlayers.score),
      ),
    )
  return row?.best ?? null
}

/** Takes the user out of whatever game they are in within this chat. */
export async function fleeGame(chatId: number, user: SessionUser) {
  const [target] = await db
    .select({ game: games })
    .from(games)
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.playerId, user.id)))
    .where(and(eq(games.chatId, chatId), inArray(games.status, ['lobby', 'active']), isNull(gamePlayers.finishedAt)))
    .orderBy(desc(games.createdAt))
    .limit(1)
  if (!target) return { outcome: 'none' as const }

  const g = (await syncGame(target.game.id))!
  if (g.status !== 'lobby' && g.status !== 'active') return { outcome: 'none' as const }

  if (g.mode === 'solo') {
    await abortGame(g, 'cancelled', user.name)
    return { outcome: 'solo_cancelled' as const, game: g }
  }

  if (g.status === 'lobby') {
    if (g.hostId === user.id) {
      await abortGame(g, 'cancelled', user.name)
      return { outcome: 'lobby_cancelled' as const, game: g }
    }
    await db.delete(gamePlayers).where(and(eq(gamePlayers.gameId, g.id), eq(gamePlayers.playerId, user.id)))
    await notify(g, 'lobby_update')
    return { outcome: 'left_lobby' as const, game: g }
  }

  await flag(g.id, user.id, 'fled')
  const remaining = (await roster(g.id)).filter((p) => !p.flagged && !p.finished)
  if (remaining.length <= 1) {
    const winnerId = remaining[0]?.id ?? null
    const [ended] = await db
      .update(games)
      .set({ status: 'finished', finishedAt: new Date(), winnerId })
      .where(and(eq(games.id, g.id), eq(games.status, 'active')))
      .returning()
    if (ended) {
      if (winnerId) await db.update(players).set({ wins: sql`${players.wins} + 1` }).where(eq(players.id, winnerId))
      await notify(ended, 'finished', { actorName: user.name })
    }
  }
  return { outcome: 'fled_battle' as const, game: g }
}

export async function getGameState(gameId: string, viewerId: number) {
  const g = await syncGame(gameId)
  if (!g) throw new GameError('not_found', 404)
  if (g.mode === 'solo' && g.hostId !== viewerId) throw new GameError('private_game', 403)

  const list = await roster(gameId)
  const [me] = await db
    .select()
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, viewerId)))
  const started = g.status !== 'lobby' && !!g.startsAt && Date.now() >= g.startsAt.getTime()
  // The Pokemon stays a surprise until the puzzle actually begins.
  const reveal = started || g.status === 'finished'
  const pokemon = reveal ? getPokemon(g.pokemonId) : undefined
  // The board ships during the countdown so pieces are already cut when it hits zero; moves stay locked until then.
  const boardReady = g.status !== 'lobby'
  // While players sit on the intro/lobby screen, fetch and composite the artwork so starting only has to cut it.
  if (g.status === 'lobby') inBackground('artwork warmup', () => getBaseImage(g.pokemonId))

  return {
    serverNow: Date.now(),
    inviteLink: await launchLink(`g_${g.id}`),
    game: {
      id: g.id,
      mode: g.mode,
      status: g.status,
      grid: g.grid,
      maxPlayers: g.maxPlayers,
      hostId: g.hostId,
      pokemon: pokemon ? { id: pokemon.id, name: pokemon.name } : null,
      lobbyDeadline: g.lobbyDeadline?.getTime() ?? null,
      startsAt: g.startsAt?.getTime() ?? null,
      endsAt: g.endsAt?.getTime() ?? null,
      winnerId: g.winnerId,
    },
    players: list.map((p) => ({ ...p, isMe: p.id === viewerId })),
    me: me
      ? {
          joined: true,
          ready: !!me.readyAt,
          board: boardReady && me.board ? me.board : null,
          correctSlots: boardReady && me.board ? filledSlots(me.board) : [],
          moves: me.moves,
          finished: !!me.finishedAt,
          solveMs: me.solveMs,
          score: me.score,
          flagged: me.flagged,
        }
      : {
          joined: false,
          ready: false,
          board: null,
          correctSlots: [],
          moves: 0,
          finished: false,
          solveMs: null,
          score: null,
          flagged: false,
        },
  }
}

export type GameState = Awaited<ReturnType<typeof getGameState>>

export async function getSheetAccess(gameId: string, viewerId: number) {
  const g = await syncGame(gameId)
  if (!g || !g.perm || !g.startsAt) throw new GameError('not_found', 404)
  // Allowed during the countdown so the client can preload; the server still rejects moves until startsAt.
  if (g.status !== 'active' && g.status !== 'finished') throw new GameError('not_active', 409)
  const [gp] = await db
    .select({ board: gamePlayers.board })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, viewerId)))
  if (!gp?.board) throw new GameError('not_in_game', 403)
  return g
}

export type LeaderboardMode = 'solo' | 'duel' | 'multi'
export type LeaderboardRow = {
  id: number
  name: string
  played: number
  wins: number
  solved: number
  bestMs: number | null
  bestScore: number | null
}

/** Solo ranks by fastest clean solve; 1v1 and multiplayer rank by wins. Disqualified runs never count. */
export async function getLeaderboard(mode: LeaderboardMode, grid: number | null): Promise<LeaderboardRow[]> {
  const modes = mode === 'duel' ? ['duel', 'battle'] : [mode]
  const gridFilter = grid ? sql`and g.grid = ${grid}` : sql``
  const order =
    mode === 'solo'
      ? sql`best_ms asc nulls last, solved desc, best_score desc nulls last`
      : sql`wins desc, best_ms asc nulls last, played desc`
  const { rows } = await db.execute<{
    id: string
    name: string
    played: string
    wins: string
    solved: string
    best_ms: number | null
    best_score: number | null
  }>(sql`
    select p.id, p.name,
      count(*) as played,
      count(*) filter (where g.winner_id = p.id) as wins,
      count(gp.finished_at) as solved,
      min(gp.solve_ms) as best_ms,
      max(gp.score) as best_score
    from game_players gp
    join games g on g.id = gp.game_id
    join players p on p.id = gp.player_id
    where g.mode in (${sql.join(modes.map((m) => sql`${m}`), sql`, `)})
      and g.status = 'finished'
      and gp.flagged = false
      ${gridFilter}
    group by p.id, p.name
    having ${mode === 'solo' ? sql`count(gp.finished_at) > 0` : sql`count(*) > 0`}
    order by ${order}
    limit 25
  `)
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    played: Number(r.played),
    wins: Number(r.wins),
    solved: Number(r.solved),
    bestMs: r.best_ms === null ? null : Number(r.best_ms),
    bestScore: r.best_score === null ? null : Number(r.best_score),
  }))
}

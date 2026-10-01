import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

/** 'battle' is a legacy mode from before duel/multi existed; it behaves like a duel. */
export type GameMode = 'solo' | 'duel' | 'multi' | 'battle'
export type GameStatus = 'lobby' | 'active' | 'finished' | 'aborted'

export const players = pgTable('players', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  username: text('username'),
  wins: integer('wins').notNull().default(0),
  games: integer('games').notNull().default(0),
  soloSolved: integer('solo_solved').notNull().default(0),
  bestMs: integer('best_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const games = pgTable('games', {
  id: text('id').primaryKey(),
  mode: text('mode').$type<GameMode>().notNull(),
  status: text('status').$type<GameStatus>().notNull(),
  pokemonId: integer('pokemon_id').notNull(),
  grid: integer('grid').notNull(),
  maxPlayers: integer('max_players').notNull().default(1),
  hostId: bigint('host_id', { mode: 'number' }).notNull(),
  chatId: bigint('chat_id', { mode: 'number' }),
  messageId: integer('message_id'),
  inlineMessageId: text('inline_message_id'),
  perm: jsonb('perm').$type<number[]>(),
  lobbyDeadline: timestamp('lobby_deadline', { withTimezone: true }),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  winnerId: bigint('winner_id', { mode: 'number' }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const gamePlayers = pgTable(
  'game_players',
  {
    gameId: text('game_id').notNull(),
    playerId: bigint('player_id', { mode: 'number' }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the player actually has the Mini App open; duels wait for everyone before the countdown. */
    readyAt: timestamp('ready_at', { withTimezone: true }),
    board: jsonb('board').$type<number[]>(),
    moves: integer('moves').notNull().default(0),
    correct: integer('correct').notNull().default(0),
    lastMoveAt: timestamp('last_move_at', { withTimezone: true }),
    burst: integer('burst').notNull().default(0),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    solveMs: integer('solve_ms'),
    score: integer('score'),
    flagged: boolean('flagged').notNull().default(false),
    flagReason: text('flag_reason'),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] })],
)

export type Game = typeof games.$inferSelect
export type GamePlayer = typeof gamePlayers.$inferSelect
export type Player = typeof players.$inferSelect

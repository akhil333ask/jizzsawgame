import type { SessionUser } from '../auth'
import { appUrl } from '../env'
import {
  GameError,
  attachMessage,
  cancelHostLobbies,
  createBattle,
  createSoloGame,
  fleeGame,
  getLeaderboard,
  getRoster,
  joinGame,
  syncGame,
} from '../game/engine'
import { DIFFICULTIES, difficultyFor, formatDuration, isGrid, type Grid } from '../game/rules'
import { botUsername, escapeHtml, launchLink, mention, tg, type InlineKeyboard } from './api'
import { notifyTelegram } from './notify'

type TgUser = { id: number; first_name: string; last_name?: string; username?: string; is_bot?: boolean }
type TgChat = { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' }
type TgMessage = { message_id: number; chat: TgChat; from?: TgUser; text?: string }
type TgCallback = { id: string; from: TgUser; data?: string; message?: TgMessage }
export type TgUpdate = { message?: TgMessage; callback_query?: TgCallback }

/** Work the webhook route must keep running after it has answered Telegram. */
export type FollowUp = { duelCountdown?: string }

const toUser = (u: TgUser): SessionUser => ({
  id: u.id,
  name: [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 64) || 'Trainer',
  username: u.username,
})

const isGroupChat = (chat: TgChat) => chat.type === 'group' || chat.type === 'supergroup'

const ERROR_TEXT: Record<string, string> = {
  lobby_full: 'This lobby is already full.',
  lobby_closed: 'This lobby is closed.',
  not_found: 'That game no longer exists.',
  rate_limited: 'Slow down - you are creating games too quickly.',
  private_game: 'That solo puzzle belongs to someone else.',
}
const errorText = (e: unknown) =>
  e instanceof GameError ? (ERROR_TEXT[e.code] ?? `Error: ${e.code}`) : 'Something went wrong. Try again.'

const HELP = [
  '<b>🧩 Pokemon Puzzle Arena</b>',
  'Solve a scrambled jigsaw of a <b>mystery Pokemon</b> faster than everyone else.',
  '',
  '<b>1. Pick a difficulty</b>',
  ...DIFFICULTIES.map((d) => `/${d.key} - ${d.grid}×${d.grid} puzzle, ${formatDuration(d.timeLimitMs)} limit`),
  '',
  '<b>2. Pick a mode</b>',
  '🧩 <b>Solo</b> - you get a private puzzle link only you can open. New group high scores are announced here.',
  '⚔️ <b>1v1</b> - a 60-second challenge countdown. The first person to accept duels you. Nobody joins? It aborts.',
  '🎮 <b>Multiplayer</b> - anyone can tap in and wait in the lobby. The host taps Start when ready.',
  '',
  '<b>How to play</b>',
  'Drag pieces from the tray onto the board. Correct pieces snap in and glow. Your score (1-100) rewards speed and accuracy.',
  '',
  '<b>Other commands</b>',
  '/flee - leave or cancel the game you are in',
  '/leaderboard - top trainers',
  '/help - show this message',
].join('\n')

async function reply(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return tg<TgMessage>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  })
}

async function answer(cq: TgCallback, text?: string, alert = false) {
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: alert })
}

/** Menu buttons carry the id of the user who opened them, so only that user can press them. */
function difficultyKeyboard(ownerId: number): InlineKeyboard {
  return { inline_keyboard: [DIFFICULTIES.map((d) => ({ text: d.label, callback_data: `d:${d.grid}:${ownerId}` }))] }
}

function modeMenu(grid: Grid, inGroup: boolean, withBack: boolean, owner: SessionUser) {
  const d = difficultyFor(grid)
  const text = [
    `<b>${d.label} ${grid}×${grid}</b> · ${formatDuration(d.timeLimitMs)} limit`,
    inGroup
      ? `${mention(owner.id, owner.name)}, how do you want to play?`
      : 'Solo works here. Add me to a group for 1v1 and Multiplayer.',
  ].join('\n')
  const rows: InlineKeyboard['inline_keyboard'] = inGroup
    ? [
        [
          { text: '🧩 Solo', callback_data: `m:${grid}:s:${owner.id}` },
          { text: '⚔️ 1v1', callback_data: `m:${grid}:d:${owner.id}` },
        ],
        [{ text: '🎮 Multiplayer', callback_data: `m:${grid}:m:${owner.id}` }],
      ]
    : [[{ text: '🧩 Play solo', callback_data: `m:${grid}:s:${owner.id}` }]]
  if (withBack) rows.push([{ text: '« Back', callback_data: `back:${owner.id}` }])
  return { text, reply_markup: { inline_keyboard: rows } }
}

async function startMenuExtras(isGroup: boolean, ownerId: number): Promise<InlineKeyboard> {
  const keyboard = difficultyKeyboard(ownerId)
  if (!isGroup) {
    const username = await botUsername()
    if (username) keyboard.inline_keyboard.push([{ text: 'Add me to a group', url: `https://t.me/${username}?startgroup=play` }])
  }
  return keyboard
}

async function handleMessage(msg: TgMessage): Promise<FollowUp | undefined> {
  const text = msg.text?.trim()
  if (!text?.startsWith('/') || !msg.from || msg.from.is_bot) return
  const [raw, startPayload] = text.split(/\s+/)
  const [commandRaw, target] = raw.slice(1).split('@')
  const username = target ? await botUsername() : undefined
  // In groups with several bots, ignore commands addressed to someone else.
  if (target && username && target.toLowerCase() !== username.toLowerCase()) return

  const command = commandRaw.toLowerCase()
  const isGroup = isGroupChat(msg.chat)
  const chatId = msg.chat.id
  const difficulty = DIFFICULTIES.find((d) => d.key === command)

  if (difficulty) {
    const menu = modeMenu(difficulty.grid, isGroup, false, toUser(msg.from))
    await reply(chatId, menu.text, { reply_markup: menu.reply_markup })
    return
  }

  // Arrives from a group "Play" deep link (t.me/<bot>?start=g_<id>) when no Main Mini App is configured.
  if (command === 'start' && !isGroup && startPayload && /^[A-Za-z0-9_-]{1,64}$/.test(startPayload)) {
    await reply(chatId, '🧩 Your puzzle is ready. Tap below to open it.', {
      reply_markup: {
        inline_keyboard: [[{ text: '▶️ Open puzzle', web_app: { url: `${appUrl()}/play?start=${startPayload}` } }]],
      },
    })
    return
  }

  switch (command) {
    case 'start':
    case 'help':
    case 'play':
      await reply(chatId, `${HELP}\n\n<b>Choose a difficulty to begin:</b>`, {
        reply_markup: await startMenuExtras(isGroup, msg.from.id),
      })
      return

    case 'flee': {
      const user = toUser(msg.from)
      const result = await fleeGame(chatId, user)
      const who = mention(user.id, user.name)
      const replies: Record<typeof result.outcome, string> = {
        none: `${who}, you are not in any game right now.`,
        solo_cancelled: `🏳️ ${who} abandoned their solo puzzle.`,
        lobby_cancelled: `🏳️ ${who} cancelled their lobby.`,
        left_lobby: `🚪 ${who} left the lobby.`,
        fled_battle: `🏃 ${who} fled the battle!`,
      }
      await reply(chatId, replies[result.outcome])
      return
    }

    case 'leaderboard':
    case 'top': {
      const [solo, duel, multi] = await Promise.all([
        getLeaderboard('solo', null),
        getLeaderboard('duel', null),
        getLeaderboard('multi', null),
      ])
      const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`
      const block = (title: string, lines: string[]) => [title, ...(lines.length ? lines : ['<i>No games yet</i>']), '']
      const text = [
        '<b>🏆 Top Trainers</b>',
        '',
        ...block(
          '🧩 <b>Solo</b> (fastest)',
          solo.slice(0, 3).map((r, i) => `${medal(i)} ${escapeHtml(r.name)} - ${formatDuration(r.bestMs ?? 0)}`),
        ),
        ...block('⚔️ <b>1v1</b> (wins)', duel.slice(0, 3).map((r, i) => `${medal(i)} ${escapeHtml(r.name)} - ${r.wins}`)),
        ...block('🎮 <b>Multiplayer</b> (wins)', multi.slice(0, 3).map((r, i) => `${medal(i)} ${escapeHtml(r.name)} - ${r.wins}`)),
      ]
      await reply(chatId, text.join('\n').trim())
      return
    }
  }
}

async function launchSolo(cq: TgCallback, grid: Grid) {
  const chat = cq.message!.chat
  const user = toUser(cq.from)
  const gameId = await createSoloGame({ user, grid, chatId: chat.id })
  const d = difficultyFor(grid)
  const text = [
    `🧩 ${mention(user.id, user.name)}, your <b>${d.label} ${grid}×${grid}</b> solo puzzle is ready!`,
    'Only you can open it. The clock starts when you do.',
  ].join('\n')
  const button = isGroupChat(chat)
    ? { text: '▶️ Play solo', url: await launchLink(`g_${gameId}`) }
    : { text: '▶️ Play solo', web_app: { url: `${appUrl()}/play?start=g_${gameId}` } }
  const sent = await reply(chat.id, text, { reply_markup: { inline_keyboard: [[button]] } })
  if (sent) await attachMessage(gameId, chat.id, sent.message_id)
  await answer(cq, 'Your solo puzzle is ready - tap Play solo.')
}

async function launchBattle(cq: TgCallback, grid: Grid, mode: 'duel' | 'multi'): Promise<FollowUp | undefined> {
  const chat = cq.message!.chat
  if (!isGroupChat(chat)) {
    await answer(cq, '1v1 and Multiplayer only work in group chats.', true)
    return
  }
  const host = toUser(cq.from)
  await cancelHostLobbies(chat.id, host)
  const gameId = await createBattle({ host, grid, mode, chatId: chat.id })
  const game = await syncGame(gameId)
  if (!game) return

  // Post a placeholder, then let the shared renderer fill in the lobby text.
  const sent = await reply(chat.id, mode === 'duel' ? '⚔️ Setting up the duel...' : '🎮 Opening the lobby...')
  if (!sent) return
  await attachMessage(gameId, chat.id, sent.message_id)
  const attached = { ...game, chatId: chat.id, messageId: sent.message_id }
  await notifyTelegram(attached, mode === 'duel' ? 'countdown' : 'lobby_update', await getRoster(gameId), { frame: 0 })

  if (mode === 'duel') {
    await answer(cq, 'Challenge posted! Waiting 60 seconds for an opponent.')
    return { duelCountdown: gameId }
  }
  await answer(cq, 'Lobby open! Tap "Join lobby" to enter the waiting room and start when ready.')
}

async function handleCallback(cq: TgCallback): Promise<FollowUp | undefined> {
  const [action, ...rest] = (cq.data ?? '').split(':')
  const msg = cq.message
  if (!msg) return void (await answer(cq))
  const inGroup = isGroupChat(msg.chat)

  if (action === 'd' || action === 'back' || action === 'm') {
    const ownerId = Number(action === 'd' ? rest[1] : action === 'back' ? rest[0] : rest[2])
    // Menus posted before ownership existed have no id; nobody can hijack them after the next /easy.
    if (!ownerId || ownerId !== cq.from.id) {
      await answer(
        cq,
        ownerId
          ? 'This menu belongs to someone else. Send /easy, /medium or /hard to start your own game.'
          : 'This menu has expired. Send /easy, /medium or /hard to start a new game.',
        true,
      )
      return
    }
  }

  try {
    if (action === 'd' || action === 'back') {
      const grid = Number(rest[0])
      if (action === 'd' && isGrid(grid)) {
        const menu = modeMenu(grid, inGroup, true, toUser(cq.from))
        await tg('editMessageText', {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          text: menu.text,
          parse_mode: 'HTML',
          reply_markup: menu.reply_markup,
        })
      } else {
        await tg('editMessageText', {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          text: `${HELP}\n\n<b>Choose a difficulty to begin:</b>`,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: await startMenuExtras(inGroup, cq.from.id),
        })
      }
      await answer(cq)
      return
    }

    if (action === 'm') {
      const grid = Number(rest[0])
      if (!isGrid(grid)) return void (await answer(cq))
      const modeLabel = { s: 'Solo', d: '1v1', m: 'Multiplayer' }[rest[1]]
      if (modeLabel && (rest[1] === 's' || inGroup)) {
        const d = difficultyFor(grid)
        await tg('editMessageText', {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          text: `${mention(cq.from.id, toUser(cq.from).name)} picked <b>${d.label} ${grid}×${grid}</b> · ${modeLabel}`,
          parse_mode: 'HTML',
        })
      }
      if (rest[1] === 's') return void (await launchSolo(cq, grid))
      if (rest[1] === 'd') return await launchBattle(cq, grid, 'duel')
      if (rest[1] === 'm') return await launchBattle(cq, grid, 'multi')
    }

    if (action === 'j') {
      const res = await joinGame(rest[0], toUser(cq.from))
      if (res.status === 'already') {
        await answer(cq, res.isHost ? 'This is your challenge - waiting for an opponent.' : 'You are already in.')
      } else {
        await answer(cq, 'Challenge accepted! Tap "Open puzzle" - the countdown starts once you are both in.')
      }
      return
    }

    await answer(cq)
  } catch (e) {
    await answer(cq, errorText(e), true)
  }
}

export async function handleUpdate(update: TgUpdate): Promise<FollowUp | undefined> {
  if (update.message) return handleMessage(update.message)
  if (update.callback_query) return handleCallback(update.callback_query)
}

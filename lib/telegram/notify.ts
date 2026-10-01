import type { Game } from '../db/schema'
import { DUEL_LOBBY_MS, MULTI_MAX_PLAYERS, difficultyFor, formatDuration } from '../game/rules'
import { escapeHtml, launchLink, mention, tg, type InlineKeyboard } from './api'

export type RosterEntry = {
  id: number
  name: string
  ready: boolean
  correct: number
  finished: boolean
  solveMs: number | null
  score: number | null
  flagged: boolean
  fled: boolean
}

export type GameEvent =
  | 'countdown'
  | 'lobby_update'
  | 'started'
  | 'expired'
  | 'cancelled'
  | 'finished'
  | 'solo_highscore'
  | 'solo_done'

type Extra = { actorName?: string; frame?: number }

const BOLD_DIGITS = ['𝟬', '𝟭', '𝟮', '𝟯', '𝟰', '𝟱', '𝟲', '𝟳', '𝟴', '𝟵']
const boldDigits = (s: string) => s.replace(/\d/g, (d) => BOLD_DIGITS[Number(d)])

const SPINNER = ['◐', '◓', '◑', '◒']
const HYPE = [
  'WHO DARES TO ACCEPT?',
  'A CHALLENGER APPROACHES...',
  'STEP INTO THE ARENA!',
  'FIRST TAP GETS THE FIGHT!',
  'THE CLOCK IS TICKING...',
]

function progressBar(fraction: number, width = 12) {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

const modeLabel = (game: Game) => (game.mode === 'multi' ? 'Multiplayer' : game.mode === 'solo' ? 'Solo' : '1v1 Duel')
const header = (game: Game) => {
  const d = difficultyFor(game.grid)
  return `${d.label} ${game.grid}×${game.grid} · ${formatDuration(d.timeLimitMs)} limit`
}

function hostOf(game: Game, roster: RosterEntry[]) {
  return roster.find((p) => p.id === game.hostId) ?? { id: game.hostId, name: 'Someone' }
}

function renderDuelCountdown(game: Game, roster: RosterEntry[], frame: number) {
  const remaining = Math.max(0, (game.lobbyDeadline?.getTime() ?? Date.now()) - Date.now())
  const host = hostOf(game, roster)
  const spin = SPINNER[frame % SPINNER.length]
  return [
    `⚔️ <b>1v1 DUEL</b> · ${header(game)}`,
    `${mention(host.id, host.name)} is looking for a challenger!`,
    '',
    `${spin}  <b>${boldDigits(formatDuration(remaining))}</b>  ${spin}`,
    `<code>${progressBar(remaining / DUEL_LOBBY_MS)}</code>`,
    `<i>${HYPE[frame % HYPE.length]}</i>`,
    '',
    'Tap <b>Accept duel</b> before the timer hits zero. The Pokemon stays a secret until the puzzle starts.',
  ].join('\n')
}

function renderDuelMatched(game: Game, roster: RosterEntry[]) {
  return [
    `⚔️ <b>DUEL MATCHED!</b> · ${header(game)}`,
    '',
    roster.map((p) => `${p.ready ? '✅' : '⏳'} ${mention(p.id, p.name)}`).join('  🆚  '),
    '',
    'Both players: tap <b>Open puzzle</b>. The countdown starts the moment you are both in, so nobody gets a head start.',
  ].join('\n')
}

const duelIsFull = (game: Game, roster: RosterEntry[]) => roster.length >= game.maxPlayers

function renderMultiLobby(game: Game, roster: RosterEntry[]) {
  const host = hostOf(game, roster)
  const names = roster.map((p, i) => `${i + 1}. ${escapeHtml(p.name)}${p.id === game.hostId ? ' (host)' : ''}`)
  return [
    `🎮 <b>MULTIPLAYER LOBBY</b> · ${header(game)}`,
    `Host: ${mention(host.id, host.name)}`,
    '',
    `<b>Waiting room (${roster.length}/${MULTI_MAX_PLAYERS})</b>`,
    ...names,
    '',
    'Tap <b>Join lobby</b> to hop in and wait inside the game. The host taps Start when everyone is ready.',
  ].join('\n')
}

function standings(game: Game, roster: RosterEntry[]) {
  const total = game.grid * game.grid
  return roster
    .toSorted((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.correct - a.correct)
    .map((p, i) => {
      const status = p.fled
        ? 'fled'
        : p.flagged
          ? 'disqualified'
          : p.finished && p.solveMs !== null
            ? `${formatDuration(p.solveMs)} · score ${p.score ?? '-'}`
            : `${Math.round((p.correct / total) * 100)}%`
      return `${i + 1}. ${escapeHtml(p.name)} - ${status}`
    })
}

async function edit(game: Game, text: string, reply_markup?: InlineKeyboard) {
  if (!game.chatId || !game.messageId) return
  await tg('editMessageText', {
    chat_id: game.chatId,
    message_id: game.messageId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: reply_markup ?? { inline_keyboard: [] },
  })
}

async function send(game: Game, text: string, reply_markup?: InlineKeyboard) {
  if (!game.chatId) return
  await tg('sendMessage', {
    chat_id: game.chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_parameters: game.messageId ? { message_id: game.messageId, allow_sending_without_reply: true } : undefined,
    reply_markup,
  })
}

export async function notifyTelegram(game: Game, event: GameEvent, roster: RosterEntry[], extra: Extra = {}) {
  if (!game.chatId) return
  const host = hostOf(game, roster)
  const openButton = async (text = '▶️ Open puzzle'): Promise<InlineKeyboard> => ({
    inline_keyboard: [[{ text, url: await launchLink(`g_${game.id}`) }]],
  })

  if (game.mode === 'solo') {
    const me = roster[0]
    if (event === 'solo_highscore' && me) {
      await edit(game, `🧩 <b>${escapeHtml(me.name)}</b> finished a ${header(game)} solo puzzle.`)
      await send(
        game,
        [
          '🏆 <b>NEW GROUP HIGH SCORE!</b>',
          `${mention(me.id, me.name)} scored <b>${me.score}</b> on ${difficultyFor(game.grid).label} (${formatDuration(me.solveMs ?? 0)}).`,
          'Think you can beat it? Send /' + difficultyFor(game.grid).key + ' and pick Solo.',
        ].join('\n'),
      )
    } else if (event === 'solo_done' && me) {
      await edit(game, `🧩 <b>${escapeHtml(me.name)}</b> finished a ${header(game)} solo puzzle.`)
    } else if (event === 'finished') {
      await edit(game, `🧩 <b>${escapeHtml(host.name)}</b> ran out of time on a ${header(game)} solo puzzle.`)
    } else if (event === 'expired' || event === 'cancelled') {
      await edit(game, `🧩 <b>${escapeHtml(host.name)}</b>'s ${header(game)} solo puzzle was abandoned.`)
    }
    return
  }

  switch (event) {
    case 'countdown':
    case 'lobby_update':
      if (game.mode === 'multi') {
        if (event === 'lobby_update') await edit(game, renderMultiLobby(game, roster), await openButton('🚀 Join lobby'))
      } else if (duelIsFull(game, roster)) {
        await edit(game, renderDuelMatched(game, roster), await openButton())
      } else {
        await edit(game, renderDuelCountdown(game, roster, extra.frame ?? 0), {
          inline_keyboard: [[{ text: '⚔️ Accept duel', callback_data: `j:${game.id}` }]],
        })
      }
      return

    case 'started': {
      const names = roster.map((p) => mention(p.id, p.name))
      if (game.mode === 'multi') {
        await edit(
          game,
          [`🎮 <b>MULTIPLAYER IN PROGRESS</b> · ${header(game)}`, '', ...roster.map((p) => `• ${escapeHtml(p.name)}`)].join('\n'),
          await openButton(),
        )
        await send(
          game,
          [
            `▶️ ${mention(host.id, host.name)} <b>started the game!</b>`,
            `Players: ${names.join(', ')}`,
            'The winner will be announced here.',
          ].join('\n'),
        )
      } else {
        await edit(
          game,
          [
            `⚔️ <b>DUEL ON!</b> · ${header(game)}`,
            '',
            names.join('  🆚  '),
            '',
            'Both trainers are in - the countdown is running. Winner is announced here.',
          ].join('\n'),
          await openButton(),
        )
      }
      return
    }

    case 'expired':
      await edit(
        game,
        game.mode === 'multi'
          ? `🎮 <b>Lobby closed</b> - ${escapeHtml(host.name)} never started the game.`
          : [
              `⌛ <b>DUEL ABORTED</b> · ${header(game)}`,
              '',
              `Nobody accepted ${mention(host.id, host.name)}'s challenge in time.`,
            ].join('\n'),
      )
      return

    case 'cancelled':
      await edit(game, `🏳️ <b>${escapeHtml(extra.actorName ?? host.name)}</b> cancelled the ${modeLabel(game)} lobby.`)
      return

    case 'finished': {
      const winner = roster.find((p) => p.id === game.winnerId)
      await edit(
        game,
        [`🏁 <b>${modeLabel(game).toUpperCase()} FINISHED</b> · ${header(game)}`, '', ...standings(game, roster)].join('\n'),
      )
      const winText = winner
        ? winner.finished
          ? `🏆 ${mention(winner.id, winner.name)} <b>wins the ${modeLabel(game)}!</b> Solved in ${formatDuration(winner.solveMs ?? 0)} with a score of <b>${winner.score}</b>.`
          : `🏆 ${mention(winner.id, winner.name)} <b>wins the ${modeLabel(game)}</b> - ${escapeHtml(extra.actorName ?? 'the opponent')} fled!`
        : extra.actorName
          ? `🏳️ Everyone fled. No winner this round.`
          : `⏰ <b>Time's up!</b> Nobody finished the puzzle this round.`
      await send(game, winText)
      return
    }
  }
}

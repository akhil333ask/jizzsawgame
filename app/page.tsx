import { HelpCircle, ShieldCheck, Swords, Timer, Users } from 'lucide-react'
import Link from 'next/link'
import { HeroPuzzle } from '@/components/landing/hero-puzzle'
import { buttonVariants } from '@/components/ui/button'

const FEATURES = [
  { icon: HelpCircle, title: 'Mystery Pokemon', body: 'Every puzzle is one of 200 Pokemon picked at random. Nobody knows who it is until the clock starts.' },
  { icon: Timer, title: 'Solo high scores', body: 'Get a private puzzle link. Beat the group high score and the bot announces it to everyone.' },
  { icon: Swords, title: '1v1 duels', body: 'A live 60-second countdown in the chat. The first person to accept fights you. Nobody? It aborts.' },
  { icon: Users, title: 'Multiplayer lobbies', body: 'Anyone can join the waiting room. The host starts when ready, and the winner is mentioned in the group.' },
  { icon: ShieldCheck, title: 'Server-verified', body: 'The solution never leaves the server. Every move is validated, rate limited and timed.' },
]

const COMMANDS = [
  ['/start', 'How to play, plus the game menu'],
  ['/easy', '3x3 puzzle - then pick Solo, 1v1 or Multiplayer'],
  ['/medium', '4x4 puzzle - then pick Solo, 1v1 or Multiplayer'],
  ['/hard', '5x5 puzzle - then pick Solo, 1v1 or Multiplayer'],
  ['/flee', 'Leave or cancel the game you are in'],
  ['/leaderboard', 'Top trainers by wins'],
]

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-20 px-5 py-10 md:py-16">
      <section className="grid items-center gap-12 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <p className="w-fit rounded-full border border-accent/40 px-3 py-1 text-xs font-medium uppercase tracking-widest text-accent">
            Telegram game bot
          </p>
          <h1 className="font-display text-4xl font-bold leading-tight text-balance md:text-6xl">
            Pokemon jigsaw battles, right inside your group chat.
          </h1>
          <p className="text-lg leading-relaxed text-muted-foreground text-pretty">
            Send /easy, /medium or /hard in your group, pick Solo, 1v1 or Multiplayer, and race to assemble a mystery
            Pokemon before anyone else.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/play" className={buttonVariants({ size: 'lg', className: 'h-12 px-6 text-base' })}>
              Try the Mini App
            </Link>
            <a href="#how" className={buttonVariants({ size: 'lg', variant: 'secondary', className: 'h-12 px-6 text-base' })}>
              How it works
            </a>
          </div>
        </div>
        <HeroPuzzle />
      </section>

      <section aria-labelledby="features" className="flex flex-col gap-6">
        <h2 id="features" className="font-display text-2xl font-bold md:text-3xl">Built for fast, fair rounds</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Icon className="size-5" />
              </span>
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how" aria-labelledby="how-heading" className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 id="how-heading" className="font-display text-2xl font-bold md:text-3xl">How a game works</h2>
          <ol className="flex flex-col gap-4">
            {[
              'Someone sends /easy, /medium or /hard in the group and taps Solo, 1v1 or Multiplayer.',
              'Solo posts a private link. 1v1 posts a live 60-second countdown. Multiplayer posts a lobby link anyone can join.',
              'The Pokemon stays hidden until the puzzle starts. Everyone in a battle gets the same scramble at the same moment.',
              'First to place every piece wins, and the bot mentions the winner in the group.',
            ].map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-display text-sm font-bold text-accent-foreground">
                  {i + 1}
                </span>
                <p className="pt-1 text-sm leading-relaxed text-muted-foreground">{step}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-2xl font-bold md:text-3xl">Commands</h2>
          <dl className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
            {COMMANDS.map(([cmd, desc]) => (
              <div key={cmd} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <dt className="font-mono text-sm text-accent">{cmd}</dt>
                <dd className="text-sm text-muted-foreground">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <footer className="border-t border-border pt-6 text-xs text-muted-foreground">
        Pokemon artwork is sourced from PokeAPI. Pokemon is a trademark of Nintendo, Creatures Inc. and GAME FREAK inc.
      </footer>
    </main>
  )
}

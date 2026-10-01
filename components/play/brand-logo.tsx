import { cn } from '@/lib/utils'

/** Full key art (logo + characters) with a soft glow so the cut-out blends into the dark arena background. */
export function BrandHero({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <div className={cn('relative mx-auto w-full max-w-sm', className)}>
      <div
        aria-hidden
        className="absolute inset-x-6 top-1/4 bottom-6 rounded-full bg-accent/20 blur-3xl"
      />
      <img
        src="/images/logo.webp"
        alt="Pokemon Jigsaw Puzzle"
        width={900}
        height={887}
        fetchPriority={priority ? 'high' : 'auto'}
        draggable={false}
        className="relative h-auto w-full select-none [mask-image:linear-gradient(to_bottom,black_78%,transparent)]"
      />
    </div>
  )
}

/** Just the "Pokemon Jigsaw Puzzle" wordmark, for compact headers like lobbies and the countdown. */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <img
      src="/images/logo-title.webp"
      alt="Pokemon Jigsaw Puzzle"
      width={450}
      height={183}
      draggable={false}
      className={cn('mx-auto h-auto w-full max-w-56 select-none drop-shadow-[0_4px_24px_rgba(250,204,21,0.25)]', className)}
    />
  )
}

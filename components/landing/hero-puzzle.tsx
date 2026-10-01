import { artworkUrl } from '@/lib/pokemon'
import { cn } from '@/lib/utils'

const GRID = 3
// Display order of tiles; a few are swapped to suggest an in-progress puzzle.
const ORDER = [0, 1, 5, 3, 4, 2, 6, 8, 7]

export function HeroPuzzle() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-6 rounded-[2.5rem] bg-primary/20 blur-3xl" aria-hidden />
      <div
        className="relative grid aspect-square grid-cols-3 gap-1.5 rounded-3xl border-2 border-border bg-card p-1.5"
        role="img"
        aria-label="A partially solved Pikachu jigsaw puzzle"
      >
        {ORDER.map((tile, slot) => {
          const placed = tile === slot
          return (
            <div
              key={slot}
              className={cn(
                'rounded-lg bg-[linear-gradient(135deg,oklch(0.87_0.17_92),oklch(0.64_0.22_27))] bg-no-repeat',
                !placed && 'rotate-3 ring-2 ring-accent',
                slot === 2 && '-translate-y-2 translate-x-1 -rotate-6 shadow-xl',
              )}
              style={{
                backgroundImage: `url(${artworkUrl(25)}), linear-gradient(135deg, oklch(0.87 0.17 92), oklch(0.64 0.22 27))`,
                backgroundSize: `${GRID * 100}% ${GRID * 100}%, ${GRID * 100}% ${GRID * 100}%`,
                backgroundPosition: `${((tile % GRID) / (GRID - 1)) * 100}% ${(Math.floor(tile / GRID) / (GRID - 1)) * 100}%`,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

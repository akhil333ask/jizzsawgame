'use client'

import { Music, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { setMusicMuted, useMusicMuted } from './music'

export function MusicToggle({ className }: { className?: string }) {
  const muted = useMusicMuted()
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className={cn('text-muted-foreground', className)}
      aria-pressed={!muted}
      onClick={() => setMusicMuted(!muted)}
    >
      {muted ? <VolumeX /> : <Music />}
      <span className="sr-only">{muted ? 'Turn music on' : 'Turn music off'}</span>
    </Button>
  )
}

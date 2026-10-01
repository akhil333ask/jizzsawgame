import type { Metadata } from 'next'
import Script from 'next/script'
import { PlayApp } from '@/components/play/play-app'

export const metadata: Metadata = {
  title: 'Play - Pokemon Puzzle Arena',
  robots: { index: false },
}

export default function PlayPage() {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      <PlayApp />
    </>
  )
}

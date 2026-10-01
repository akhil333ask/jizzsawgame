'use client'

import { useEffect, useState } from 'react'

/** Returns an estimate of the server's current time, ticking every `intervalMs`. */
export function useServerClock(serverNow: number | undefined, receivedAt: number | undefined, intervalMs = 250) {
  const offset = serverNow && receivedAt ? serverNow - receivedAt : 0
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now + offset
}

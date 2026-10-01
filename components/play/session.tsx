'use client'

import { createContext, useCallback, useContext, type ReactNode } from 'react'
import useSWR from 'swr'

type TelegramWebApp = {
  initData: string
  initDataUnsafe: { start_param?: string }
  ready: () => void
  expand: () => void
  disableVerticalSwipes?: () => void
  switchInlineQuery?: (query: string, types?: string[]) => void
  openTelegramLink?: (url: string) => void
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy') => void
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void
  }
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null
  const app = window.Telegram?.WebApp
  return app && app.initData ? app : null
}

export function haptic(kind: 'tap' | 'success' | 'error') {
  const h = getWebApp()?.HapticFeedback
  if (!h) return
  if (kind === 'tap') h.impactOccurred('light')
  else h.notificationOccurred(kind)
}

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
  }
}

type SessionUser = { id: number; name: string; username?: string }
type Session = { token: string; user: SessionUser; inTelegram: boolean; startParam: string | null }

async function waitForTelegram(timeoutMs = 2500) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (window.Telegram?.WebApp) return window.Telegram.WebApp
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
}

async function authenticate(): Promise<Session> {
  const app = await waitForTelegram()
  const initData = app?.initData ?? ''
  if (app && initData) {
    app.ready()
    app.expand()
    app.disableVerticalSwipes?.()
    app.setHeaderColor?.('#15172a')
    app.setBackgroundColor?.('#15172a')
  }

  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(initData ? { initData } : { guest: true }),
  })
  const data = await res.json()
  if (!res.ok) throw new ApiError(data.error ?? 'auth_failed', res.status)

  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const startParam =
    app?.initDataUnsafe?.start_param ||
    new URLSearchParams(initData).get('start_param') ||
    hash.get('tgWebAppStartParam') ||
    search.get('tgWebAppStartParam') ||
    search.get('startapp') ||
    search.get('start') ||
    null
  return { token: data.token, user: data.user, inTelegram: !!initData, startParam }
}

type SessionContextValue = Session & {
  api: <T>(path: string, init?: RequestInit) => Promise<T>
  fetchBlob: (path: string) => Promise<Blob>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}

export function SessionProvider({ children, fallback, errorView }: {
  children: ReactNode
  fallback: ReactNode
  errorView: (error: ApiError) => ReactNode
}) {
  const { data, error } = useSWR('telegram-session', authenticate, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  })

  const token = data?.token
  const api = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(path, {
        ...init,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init?.headers },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new ApiError(body.error ?? 'request_failed', res.status)
      return body as T
    },
    [token],
  )
  const fetchBlob = useCallback(
    async (path: string) => {
      const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new ApiError(body.error ?? 'request_failed', res.status)
      }
      return res.blob()
    },
    [token],
  )

  if (error) return <>{errorView(error instanceof ApiError ? error : new ApiError('auth_failed', 500))}</>
  if (!data) return <>{fallback}</>
  return <SessionContext.Provider value={{ ...data, api, fetchBlob }}>{children}</SessionContext.Provider>
}

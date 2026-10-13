import {
  isLocale,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type Permission,
} from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from '@/components/ui/toaster'
import i18n, { currentLocale, setLocale } from '@/i18n'
import * as authService from '@/services/auth.service'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'offline'

export interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  /** Why the last session ended (shown on the sign-in page). */
  signedOutReason: 'logout' | 'expired' | null
}

export interface AuthContextValue extends AuthState {
  login(input: LoginInput): Promise<AuthUser>
  logout(): Promise<void>
  logoutEverywhere(): Promise<void>
  changePassword(input: ChangePasswordInput): Promise<AuthUser>
  /** Retry restoring the session after a network failure on start-up. */
  retry(): void
  /** UI-level permission check. The API enforces permissions regardless. */
  can(permission: Permission): boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const CHANNEL = 'mx-auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    signedOutReason: null,
  })
  const userRef = useRef<AuthUser | null>(null)
  userRef.current = state.user
  const channelRef = useRef<BroadcastChannel | null>(null)

  const applyUser = useCallback((user: AuthUser) => {
    setState({ status: 'authenticated', user, signedOutReason: null })
    if (isLocale(user.preferredLocale) && user.preferredLocale !== currentLocale()) {
      void setLocale(user.preferredLocale)
    }
  }, [])

  // refreshSession() is single-flight, so StrictMode's double effect shares one request.
  // On start-up the request is usually already running (started in main.tsx).
  const restore = useCallback((startup = false) => {
    setState((s) => ({ ...s, status: 'loading' }))
    return (startup ? authService.takeSessionRestore() : authService.refreshSession())
      .then((session) => {
        if (session) applyUser(session.user)
        else setState({ status: 'anonymous', user: null, signedOutReason: null })
      })
      .catch(() => setState({ status: 'offline', user: null, signedOutReason: null }))
  }, [applyUser])

  // Restore the session from the refresh cookie on start-up.
  useEffect(() => {
    void restore(true)
  }, [restore])

  // React to session events (expiry mid-session, sign-out, token refresh).
  useEffect(
    () =>
      authService.subscribeSession((event) => {
        if (event.type === 'signedOut') {
          queryClient.clear()
          setState({ status: 'anonymous', user: null, signedOutReason: event.reason })
          channelRef.current?.postMessage('signedOut')
        } else {
          applyUser(event.session.user)
          if (event.type === 'signedIn') channelRef.current?.postMessage('signedIn')
        }
      }),
    [applyUser, queryClient],
  )

  // Keep tabs in sync: sign out everywhere in this browser, pick up sign-ins from other tabs.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(CHANNEL)
    channelRef.current = channel
    channel.onmessage = (e) => {
      if (e.data === 'signedOut' && userRef.current) {
        queryClient.clear()
        setState({ status: 'anonymous', user: null, signedOutReason: 'logout' })
      } else if (e.data === 'signedIn' && !userRef.current) {
        void restore()
      }
    }
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [queryClient, restore])

  // Language chosen while signed in is saved to the account.
  useEffect(() => {
    const onChange = (lng: string) => {
      const user = userRef.current
      if (!user || !isLocale(lng) || user.preferredLocale === lng) return
      setState((s) => (s.user ? { ...s, user: { ...s.user, preferredLocale: lng } } : s))
      authService
        .updatePreferences(lng)
        .then(() => toast.success(i18n.t('account.languageSaved')))
        .catch(() => {
          // Not critical: the language still applies on this device.
        })
    }
    i18n.on('languageChanged', onChange)
    return () => i18n.off('languageChanged', onChange)
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(state.user?.permissions ?? [])
    return {
      ...state,
      login: async (input) => (await authService.login(input)).user,
      logout: () => authService.logout(),
      logoutEverywhere: () => authService.logoutEverywhere(),
      changePassword: async (input) => (await authService.changePassword(input)).user,
      retry: () => void restore(),
      can: (permission) => state.user?.isSuperAdmin === true || permissions.has(permission),
    }
  }, [state, restore])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** For components that only render when signed in (inside RequireAuth). */
export function useCurrentUser(): AuthUser {
  const { user } = useAuth()
  if (!user) throw new Error('useCurrentUser used outside an authenticated route')
  return user
}

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { OfflineSync } from '@/components/common/OfflineBanner'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/contexts/AuthContext'
import { queryClient as defaultClient } from './query-client'

interface AppProvidersProps extends PropsWithChildren {
  /** Override for tests. */
  queryClient?: QueryClient
}

export function AppProviders({ children, queryClient = defaultClient }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={300} skipDelayDuration={150}>
          {children}
          <OfflineSync />
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/fonts'
import '@/styles/index.css'
// Phone / small-tablet layout only (all rules are inside max-width media queries).
import '@/styles/mobile.css'
import '@/i18n'
import { AppProviders } from '@/app/providers'
import { startUp } from '@/app/startup'
import { installZodI18n } from '@/components/forms/zod-i18n'
import { AppRouter } from '@/routes'

// Session and home-screen data are requested before React renders.
startUp()
installZodI18n()

// Offline app shell + push notifications (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </StrictMode>,
)

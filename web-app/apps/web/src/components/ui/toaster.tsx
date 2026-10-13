import { useSyncExternalStore } from 'react'
import { Toaster as Sonner, toast } from 'sonner'

const PHONE = '(max-width: 1023px)'

/** Phones show toasts at the top so they never cover the bottom action bar. */
function phoneQuery(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  return window.matchMedia(PHONE) ?? undefined
}

function useIsPhone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = phoneQuery()
      if (!mq?.addEventListener) return () => undefined
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => phoneQuery()?.matches ?? false,
    () => false,
  )
}

/** One toaster for the whole app. Short, quiet confirmations; errors that need action use inline states. */
export function Toaster() {
  const phone = useIsPhone()
  return (
    <Sonner
      position={phone ? 'top-center' : 'bottom-right'}
      closeButton
      duration={4000}
      visibleToasts={3}
      toastOptions={{
        classNames: {
          toast:
            'group !rounded-md !border !border-border !bg-popover !text-popover-foreground !shadow-popover !font-sans !text-sm',
          description: '!text-muted-foreground',
          actionButton: '!bg-primary !text-primary-foreground',
          cancelButton: '!bg-muted !text-foreground',
          success: '[&_[data-icon]]:!text-success',
          error: '[&_[data-icon]]:!text-danger',
          warning: '[&_[data-icon]]:!text-warning',
          info: '[&_[data-icon]]:!text-info',
        },
      }}
    />
  )
}

export { toast }

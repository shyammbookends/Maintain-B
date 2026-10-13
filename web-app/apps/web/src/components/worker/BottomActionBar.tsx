import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface BottomActionBarProps {
  children: ReactNode
  /** Short status line above the buttons, e.g. "3 of 7 steps done". */
  hint?: ReactNode
  className?: string
}

/**
 * The one primary action of a worker screen, pinned within thumb reach.
 * Renders a spacer so page content never hides behind the bar.
 */
export function BottomActionBar({ children, hint, className }: BottomActionBarProps) {
  return (
    <>
      <div
        aria-hidden
        className={
          hint
            ? 'h-[calc(7rem+env(safe-area-inset-bottom))]'
            : 'h-[calc(5rem+env(safe-area-inset-bottom))]'
        }
      />
      <div className="glass fixed inset-x-0 bottom-0 z-30 border-t pb-safe lg:left-64">
        <div
          className={cn('mx-auto grid max-w-2xl gap-2 px-4 py-3 lg:max-w-5xl lg:px-8', className)}
        >
          {hint && <p className="text-center text-13 text-muted-foreground">{hint}</p>}
          {/* Phone: full-width buttons in thumb reach. Desktop: right-aligned. */}
          <div className="flex gap-2 *:flex-1 lg:justify-end lg:*:min-w-44 lg:*:flex-none">
            {children}
          </div>
        </div>
      </div>
    </>
  )
}

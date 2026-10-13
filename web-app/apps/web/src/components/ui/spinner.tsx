import { Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'

interface SpinnerProps {
  className?: string
  /** Accessible label. Omit when the spinner sits inside a control that already announces state. */
  label?: string
}

export function Spinner({ className, label }: SpinnerProps) {
  return (
    <Loader2
      className={cn('size-4 animate-spin', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}

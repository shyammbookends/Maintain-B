import type { ComponentProps } from 'react'
import { cn } from '@/utils/cn'

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-shimmer rounded-md bg-muted', className)}
      {...props}
    />
  )
}

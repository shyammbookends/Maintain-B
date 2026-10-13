import type { ComponentProps } from 'react'
import { cn } from '@/utils/cn'

export const inputBaseClass = cn(
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground',
  'placeholder:text-muted-foreground transition-colors duration-(--duration-fast)',
  'focus-visible:border-ring focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring/30',
  'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
  'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger/30',
  'file:border-0 file:bg-transparent file:text-sm file:font-medium',
)

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input data-slot="input" type={type} className={cn(inputBaseClass, className)} {...props} />
  )
}

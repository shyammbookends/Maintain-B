import type { ComponentProps } from 'react'
import { cn } from '@/utils/cn'
import { inputBaseClass } from './input'

export function Textarea({ className, rows = 3, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(inputBaseClass, 'h-auto min-h-16 py-2 leading-relaxed', className)}
      {...props}
    />
  )
}

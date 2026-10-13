import { Avatar as AvatarPrimitive } from 'radix-ui'
import { cn } from '@/utils/cn'

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = Array.from(parts[0]!)[0] ?? ''
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : ''
  return (first + last).toUpperCase()
}

interface AvatarProps {
  name: string
  src?: string | null
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const SIZE: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
}

export function Avatar({ name, src, className, size = 'md' }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn('relative flex shrink-0 overflow-hidden rounded-full', SIZE[size], className)}
    >
      {src && (
        <AvatarPrimitive.Image
          src={src}
          alt={name}
          className="aspect-square size-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback
        className="flex size-full items-center justify-center bg-secondary font-medium text-secondary-foreground"
        delayMs={src ? 300 : 0}
      >
        <span aria-hidden>{initialsOf(name)}</span>
        <span className="sr-only">{name}</span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/*
 * tailwind-merge must know the project's custom theme values (styles/index.css), or it
 * misreads them: `text-13` would be taken for a text colour and silently drop
 * `text-foreground` / `text-white` (or the other way round), and `shadow-card` for a
 * shadow colour.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['13'],
      shadow: ['card', 'card-hover', 'popover'],
    },
  },
})

/** Merge Tailwind classes without duplicates or conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

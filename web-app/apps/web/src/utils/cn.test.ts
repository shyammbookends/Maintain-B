import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('keeps the text colour next to the custom 13px font size', () => {
    expect(cn('text-foreground', 'text-13')).toBe('text-foreground text-13')
    expect(cn('text-13', 'text-white')).toBe('text-13 text-white')
  })

  it('still merges conflicting font sizes and shadows', () => {
    expect(cn('text-13', 'text-sm')).toBe('text-sm')
    expect(cn('shadow-card', 'shadow-sm')).toBe('shadow-sm')
  })
})

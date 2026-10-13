import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { cn } from '@/utils/cn'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  delayMs?: number
  className?: string
}

/**
 * Debounced search box. Typing updates locally; `onChange` fires once the user
 * pauses, so the list query isn't re-run on every keystroke.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  delayMs = 300,
  className,
}: SearchInputProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  const debounced = useDebouncedValue(draft, delayMs)
  const lastEmitted = useRef(value)

  // Emit after the pause.
  useEffect(() => {
    if (debounced !== lastEmitted.current) {
      lastEmitted.current = debounced
      onChange(debounced)
    }
  }, [debounced, onChange])

  // Follow external changes (e.g. "Clear filters", back/forward navigation).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value
      setDraft(value)
    }
  }, [value])

  return (
    <div className={cn('relative w-full sm:w-64', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && draft) {
            e.preventDefault()
            setDraft('')
          }
        }}
        placeholder={placeholder ?? t('table.search')}
        aria-label={placeholder ?? t('table.search')}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
        maxLength={200}
      />
      {draft && (
        <button
          type="button"
          onClick={() => setDraft('')}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={t('actions.clear')}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

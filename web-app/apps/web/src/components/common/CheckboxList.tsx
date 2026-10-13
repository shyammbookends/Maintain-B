import { Search } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/utils/cn'

export interface CheckboxOption {
  value: string
  label: string
  description?: ReactNode
  disabled?: boolean
}

interface CheckboxListProps {
  options: readonly CheckboxOption[]
  value: readonly string[]
  onChange: (value: string[]) => void
  /** Show a filter box (useful above ~8 options). */
  searchable?: boolean
  emptyMessage?: ReactNode
  disabled?: boolean
  invalid?: boolean
  className?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/**
 * Multi-select as a plain list of checkboxes: every choice is visible, works
 * well on phones, and needs no popover. Selected options keep their order.
 */
export function CheckboxList({
  options,
  value,
  onChange,
  searchable = options.length > 8,
  emptyMessage,
  disabled,
  invalid,
  className,
  ...aria
}: CheckboxListProps) {
  const { t } = useTranslation()
  const id = useId()
  const [filter, setFilter] = useState('')
  const selected = useMemo(() => new Set(value), [value])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, filter])

  const selectable = visible.filter((o) => !o.disabled)
  const allVisibleSelected = selectable.length > 0 && selectable.every((o) => selected.has(o.value))

  const toggle = (v: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(v)
    else next.delete(v)
    onChange(options.map((o) => o.value).filter((x) => next.has(x)))
  }

  const toggleAll = () => {
    const next = new Set(selected)
    for (const o of selectable) {
      if (allVisibleSelected) next.delete(o.value)
      else next.add(o.value)
    }
    onChange(options.map((o) => o.value).filter((x) => next.has(x)))
  }

  if (options.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-4 text-center text-13 text-muted-foreground">
        {emptyMessage}
      </p>
    )
  }

  return (
    <div
      role="group"
      {...aria}
      aria-invalid={invalid || undefined}
      className={cn('overflow-hidden rounded-md border', invalid && 'border-danger', className)}
    >
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5 text-13">
        <span className="text-muted-foreground tabular">
          {selected.size === 0
            ? t('common.noneSelected')
            : t('common.selectedCount', { count: selected.size })}
        </span>
        {selectable.length > 1 && (
          <button
            type="button"
            onClick={toggleAll}
            disabled={disabled}
            className="font-medium text-primary hover:underline disabled:opacity-50"
          >
            {allVisibleSelected ? t('common.clearAll') : t('common.selectAll')}
          </button>
        )}
      </div>
      {searchable && (
        <div className="relative border-b">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            className="h-9 rounded-none border-0 pl-9 focus-visible:outline-none"
          />
        </div>
      )}
      <ul className="max-h-64 overflow-y-auto py-1">
        {visible.map((o) => {
          const optionId = `${id}-${o.value}`
          return (
            <li key={o.value}>
              <label
                htmlFor={optionId}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm hover:bg-muted/50',
                  (disabled || o.disabled) && 'cursor-not-allowed opacity-60',
                )}
              >
                <Checkbox
                  id={optionId}
                  checked={selected.has(o.value)}
                  onCheckedChange={(v) => toggle(o.value, v === true)}
                  disabled={disabled || o.disabled}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.description && (
                    <span className="block text-xs text-muted-foreground">{o.description}</span>
                  )}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

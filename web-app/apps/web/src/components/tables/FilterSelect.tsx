import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/utils/cn'

const ALL = '__all__'

interface FilterSelectProps {
  label: string
  value: string | undefined
  onChange: (value: string | undefined) => void
  options: ReadonlyArray<{ value: string; label: ReactNode }>
  className?: string
}

/** Compact single-value filter for table toolbars. "All" clears the filter. */
export function FilterSelect({ label, value, onChange, options, className }: FilterSelectProps) {
  const { t } = useTranslation()
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger
        aria-label={label}
        className={cn('h-9 w-auto min-w-36 gap-1.5', value && 'border-border-strong', className)}
      >
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={ALL}>{t('common.all')}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

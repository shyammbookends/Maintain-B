import type { StepResult } from '@maintainx/shared'
import { Check, Minus, X, type LucideIcon } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/cn'
import { enumLabel } from '@/utils/i18n'

const OPTIONS: Array<{ value: StepResult; Icon: LucideIcon; checked: string }> = [
  {
    value: 'PASS',
    Icon: Check,
    checked:
      'data-[state=checked]:border-success data-[state=checked]:bg-success-soft data-[state=checked]:text-success-fg',
  },
  {
    value: 'FAIL',
    Icon: X,
    checked:
      'data-[state=checked]:border-danger data-[state=checked]:bg-danger-soft data-[state=checked]:text-danger-fg',
  },
  {
    value: 'NA',
    Icon: Minus,
    checked:
      'data-[state=checked]:border-border-strong data-[state=checked]:bg-neutral-soft data-[state=checked]:text-neutral-fg',
  },
]

interface ResultToggleProps {
  value: StepResult | null | undefined
  onChange: (value: StepResult) => void
  /** id of the element that names this step (its title). */
  labelledBy: string
  disabled?: boolean
  className?: string
}

/**
 * PASS / FAIL / N/A for a checklist step. Large (48px) targets for gloved or
 * wet hands; radio semantics with arrow-key navigation.
 */
export function ResultToggle({
  value,
  onChange,
  labelledBy,
  disabled,
  className,
}: ResultToggleProps) {
  const { t } = useTranslation()
  return (
    <RadioGroupPrimitive.Root
      value={value ?? ''}
      onValueChange={(v) => onChange(v as StepResult)}
      aria-labelledby={labelledBy}
      orientation="horizontal"
      disabled={disabled}
      className={cn('grid grid-cols-3 gap-2', className)}
    >
      {OPTIONS.map(({ value: v, Icon, checked }) => (
        <RadioGroupPrimitive.Item
          key={v}
          value={v}
          className={cn(
            'flex h-12 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2 text-sm font-medium text-foreground',
            'transition-colors duration-(--duration-fast) active:bg-muted',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            checked,
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden strokeWidth={2.5} />
          <span className="truncate">{enumLabel(t, 'stepResult', v)}</span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}

import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/utils/cn'

interface MoreOptionsProps {
  children: ReactNode
  defaultOpen?: boolean
  /**
   * Force the section open — pass true when a field inside it has a validation
   * error, so the user can see what to fix.
   */
  forceOpen?: boolean
  className?: string
}

/**
 * Progressive disclosure for advanced fields. Content stays mounted while
 * collapsed so form values and focus management keep working.
 */
export function MoreOptions({
  children,
  defaultOpen = false,
  forceOpen = false,
  className,
}: MoreOptionsProps) {
  const { t } = useTranslation()
  const [userOpen, setUserOpen] = useState(defaultOpen)
  const open = userOpen || forceOpen

  return (
    <Collapsible open={open} onOpenChange={setUserOpen} className={className}>
      <CollapsibleTrigger
        className={cn(
          'inline-flex items-center gap-1 rounded-sm text-13 font-medium text-primary',
          'hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:cursor-default disabled:no-underline',
        )}
        disabled={forceOpen}
      >
        {open ? t('actions.fewerOptions') : t('actions.moreOptions')}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 transition-transform duration-(--duration-base)',
            open && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>
      {/* forceMount keeps fields registered; `hidden` removes them from view and the a11y tree. */}
      <CollapsibleContent forceMount hidden={!open} className="grid gap-4 pt-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

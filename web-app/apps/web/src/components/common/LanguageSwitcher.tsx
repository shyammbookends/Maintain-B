import { LOCALE_LABELS, SUPPORTED_LOCALES, isLocale } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { inputBaseClass } from '@/components/ui/input'
import { currentLocale, setLocale } from '@/i18n'
import { cn } from '@/utils/cn'

interface LanguageSwitcherProps {
  className?: string
}

/** Native select on purpose: best on phones, zero JS overhead, fully accessible. */
export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { t } = useTranslation()

  return (
    <select
      aria-label={t('common.language')}
      value={currentLocale()}
      onChange={(e) => {
        if (isLocale(e.target.value)) void setLocale(e.target.value)
      }}
      className={cn(inputBaseClass, 'h-8 w-auto pr-7 text-13', className)}
    >
      {SUPPORTED_LOCALES.map((locale) => (
        <option key={locale} value={locale}>
          {LOCALE_LABELS[locale]}
        </option>
      ))}
    </select>
  )
}

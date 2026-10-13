import { useTranslation } from 'react-i18next'

/** First focusable element on every page: lets keyboard users jump past navigation. */
export function SkipLink() {
  const { t } = useTranslation()
  return (
    <a
      href="#main-content"
      className="sr-only z-100 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {t('nav.skipToContent')}
    </a>
  )
}

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale, type Locale } from '@maintainx/shared'
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en/common.json'

export const LOCALE_STORAGE_KEY = 'mx.locale'

/** English ships with the app; Hindi and Gujarati load on demand (~30 KB each). */
export const resources = {
  en: { common: en },
} as const

const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: typeof en }>> = {
  hi: () => import('./locales/hi/common.json'),
  gu: () => import('./locales/gu/common.json'),
}

/** Loads a language's strings once; later calls are instant. */
export async function ensureLocale(lng: string): Promise<void> {
  const base = lng.split('-')[0] as Locale
  if (base === 'en' || !isLocale(base) || i18n.hasResourceBundle(base, 'common')) return
  const mod = await loaders[base]()
  i18n.addResourceBundle(base, 'common', mod.default, true, true)
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    partialBundledLanguages: true,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    load: 'languageOnly',
    defaultNS: 'common',
    ns: ['common'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  })

// Every language switch (switcher, saved preference, tests) waits for the strings.
const changeLanguageNow = i18n.changeLanguage.bind(i18n)
i18n.changeLanguage = (async (lng?: string, callback?: Parameters<typeof changeLanguageNow>[1]) => {
  if (lng) await ensureLocale(lng)
  return changeLanguageNow(lng, callback)
}) as typeof i18n.changeLanguage

// A saved / detected Hindi or Gujarati choice: fetch it, then switch.
if (i18n.language && !i18n.language.startsWith('en')) void i18n.changeLanguage(i18n.language)

function applyDocumentLanguage(lng: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lng
}

i18n.on('languageChanged', applyDocumentLanguage)
applyDocumentLanguage(i18n.resolvedLanguage ?? DEFAULT_LOCALE)

export function currentLocale(): Locale {
  const lng = i18n.resolvedLanguage ?? i18n.language
  return isLocale(lng) ? lng : DEFAULT_LOCALE
}

export function setLocale(locale: Locale): Promise<unknown> {
  return i18n.changeLanguage(locale)
}

export default i18n

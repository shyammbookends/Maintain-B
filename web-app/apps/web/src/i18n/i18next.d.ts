import 'i18next'
import type en from './locales/en/common.json'

// Typed translation keys: a typo in t('…') is a compile error.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: { common: typeof en }
  }
}

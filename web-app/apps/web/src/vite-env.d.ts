/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin. Empty = same origin. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

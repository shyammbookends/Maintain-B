import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/server/prisma/migrations/**',
      'apps/server/storage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // shadcn/ui convention: primitives export their variant helpers (buttonVariants,
    // useFormField, toast…) next to the component. Fast refresh still works for pages.
    // Context modules export their provider together with the hook that reads it.
    files: [
      'apps/web/src/components/ui/**/*.tsx',
      'apps/web/src/components/forms/form.tsx',
      'apps/web/src/contexts/**/*.tsx',
    ],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: [
      'apps/server/**/*.ts',
      'packages/**/*.ts',
      '*.mjs',
      'apps/*/scripts/**/*.mjs',
      'scripts/**/*.mjs',
      'api/**/*.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
)

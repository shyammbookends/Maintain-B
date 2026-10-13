import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    // Transform the start-up modules while the server boots, so the first page
    // load after `npm run dev` doesn't wait for them one request at a time.
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/layouts/AppShells.tsx',
        './src/pages/auth/LoginPage.tsx',
        './src/pages/admin/dashboard/AdminIndex.tsx',
        './src/pages/worker/WorkerHomePage.tsx',
      ],
    },
    // Same-origin API in development; cookies and CORS behave like production.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Libraries change far less often than app code: keeping them in their own
        // long-cached files means a deploy only re-downloads the app's own code.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)) return 'react'
          if (id.includes('@tanstack/react-query')) return 'query'
          if (/node_modules\/(i18next|react-i18next|i18next-browser-languagedetector)\//.test(id))
            return 'i18n'
          if (
            /node_modules\/(@radix-ui|@floating-ui|radix-ui|react-remove-scroll|aria-hidden|sonner|tailwind-merge|clsx|class-variance-authority)/.test(
              id,
            )
          )
            return 'ui'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    css: false,
    restoreMocks: true,
  },
})

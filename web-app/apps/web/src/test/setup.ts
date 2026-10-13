import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import '@/i18n'
import { installZodI18n } from '@/components/forms/zod-i18n'

installZodI18n()

// Full-app tests (router + lazy routes + axe) run in parallel; 1s is too tight under load.
configure({ asyncUtilTimeout: 3000 })

// jsdom gaps that Radix primitives rely on.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
}
if (!window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  window.HTMLElement.prototype.setPointerCapture = vi.fn()
}
if (typeof window.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// React Router creates `new Request(url, { signal })` for lazy routes. Under jsdom the
// signal is jsdom's AbortSignal, which Node's Request rejects (different realm).
// Browsers don't have this split, so in tests we drop the signal from such Requests.
{
  const NodeRequest = globalThis.Request
  class TestRequest extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.signal) {
        const { signal: _signal, ...rest } = init
        super(input, rest)
      } else {
        super(input, init)
      }
    }
  }
  globalThis.Request = TestRequest as typeof Request
}

afterEach(() => {
  cleanup()
})

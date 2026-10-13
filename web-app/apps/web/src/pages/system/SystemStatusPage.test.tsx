import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '@/app/providers'
import i18n from '@/i18n'
import { SystemStatusPage } from './SystemStatusPage'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const HEALTH = {
  data: {
    status: 'ok',
    service: 'maintainx-api',
    version: '0.1.0',
    environment: 'test',
    uptimeSeconds: 3725,
    timestamp: new Date().toISOString(),
  },
}

const READY = {
  data: {
    status: 'ready',
    checks: { database: { status: 'up', latencyMs: 4 } },
    timestamp: new Date().toISOString(),
  },
}

const DEGRADED = {
  data: {
    status: 'degraded',
    checks: { database: { status: 'down', latencyMs: 2000 } },
    timestamp: new Date().toISOString(),
  },
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AppProviders queryClient={client}>
      <SystemStatusPage />
    </AppProviders>,
  )
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input)))),
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('SystemStatusPage', () => {
  it('shows API and database as up with details', async () => {
    mockFetch((url) => (url.endsWith('/health') ? jsonResponse(HEALTH) : jsonResponse(READY)))
    renderPage()

    expect(await screen.findByText('All systems operational.')).toBeInTheDocument()
    expect(screen.getAllByText('Up')).toHaveLength(2)
    expect(screen.getByText('0.1.0')).toBeInTheDocument()
    expect(screen.getByText('1h 2m')).toBeInTheDocument()
    expect(screen.getByText('4 ms')).toBeInTheDocument()
  })

  it('explains a database outage when the API answers 503', async () => {
    mockFetch((url) =>
      url.endsWith('/health') ? jsonResponse(HEALTH) : jsonResponse(DEGRADED, 503),
    )
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach PostgreSQL/)
    expect(screen.getByText('Down')).toBeInTheDocument()
  })

  it('explains when the API itself is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/API is not reachable/)
    expect(screen.getAllByText('Down')).toHaveLength(2)
  })

  it('switches language at runtime', async () => {
    mockFetch((url) => (url.endsWith('/health') ? jsonResponse(HEALTH) : jsonResponse(READY)))
    renderPage()
    await screen.findByText('All systems operational.')

    await userEvent.selectOptions(screen.getByLabelText('Language'), 'hi')
    await waitFor(() => expect(screen.getByText('सिस्टम स्थिति')).toBeInTheDocument())
    expect(document.documentElement.lang).toBe('hi')

    await userEvent.selectOptions(screen.getByLabelText('भाषा'), 'gu')
    await waitFor(() => expect(screen.getByText('સિસ્ટમ સ્થિતિ')).toBeInTheDocument())
  })
})

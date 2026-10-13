import {
  ASSET_STATUS,
  PRIORITY,
  PURCHASE_ORDER_STATUS,
  REQUEST_STATUS,
  STEP_RESULT,
  WORK_ORDER_STATUS,
} from '@maintainx/shared'
import { render } from '@testing-library/react'
import { afterAll, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import type { StatusKind } from '@/utils/status'
import { StatusBadge } from './StatusBadge'

const ALL: Array<[StatusKind, readonly string[]]> = [
  ['workOrderStatus', WORK_ORDER_STATUS],
  ['assetStatus', ASSET_STATUS],
  ['purchaseOrderStatus', PURCHASE_ORDER_STATUS],
  ['requestStatus', REQUEST_STATUS],
  ['priority', PRIORITY],
  ['stepResult', STEP_RESULT],
]

afterAll(async () => {
  await i18n.changeLanguage('en')
})

describe.each(['en', 'hi', 'gu'])('StatusBadge (%s)', (lng) => {
  it('renders a translated label (never the raw enum) for every value', async () => {
    await i18n.changeLanguage(lng)
    for (const [kind, values] of ALL) {
      for (const value of values) {
        const { container, unmount } = render(<StatusBadge kind={kind} value={value as never} />)
        const text = container.textContent ?? ''
        expect(text, `${kind}.${value}`).not.toBe('')
        expect(text, `${kind}.${value}`).not.toBe(value)
        unmount()
      }
    }
  })
})

it('uses the danger tone for critical priority and broken assets', () => {
  const { container: a } = render(<StatusBadge kind="priority" value="CRITICAL" />)
  expect(a.firstElementChild).toHaveClass('bg-danger-soft')
  const { container: b } = render(<StatusBadge kind="assetStatus" value="BROKEN" />)
  expect(b.firstElementChild).toHaveClass('bg-danger-soft')
})

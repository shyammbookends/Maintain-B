import type { StepResult } from '@maintainx/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { ResultToggle } from './ResultToggle'

function Harness({ initial }: { initial?: StepResult }) {
  const [value, setValue] = useState<StepResult | undefined>(initial)
  return (
    <div>
      <p id="step-1">Door seal</p>
      <ResultToggle labelledBy="step-1" value={value} onChange={setValue} />
      <output data-testid="value">{value ?? 'none'}</output>
    </div>
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('ResultToggle', () => {
  it('is a labelled radio group with Pass / Fail / N/A', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'Door seal' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Pass', 'Fail', 'N/A'])
    expect(screen.getByTestId('value')).toHaveTextContent('none')
  })

  it('selects by tap and reflects aria-checked', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'Fail' }))
    expect(screen.getByTestId('value')).toHaveTextContent('FAIL')
    expect(screen.getByRole('radio', { name: 'Fail' })).toHaveAttribute('aria-checked', 'true')
  })

  it('supports arrow-key navigation', async () => {
    const user = userEvent.setup()
    render(<Harness initial="PASS" />)
    screen.getByRole('radio', { name: 'Pass' }).focus()
    // Radix moves focus on the next tick and selects only while the arrow is held,
    // so hold the key (as a real key press does) until selection follows focus.
    await user.keyboard('{ArrowRight>}')
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('FAIL'))
    await user.keyboard('{/ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Fail' })).toHaveFocus()
  })

  it('labels follow the UI language', async () => {
    await i18n.changeLanguage('gu')
    render(<Harness />)
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'પાસ',
      'ફેલ',
      'લાગુ નથી',
    ])
  })
})

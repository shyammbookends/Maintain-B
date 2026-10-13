import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { passwordSchema } from '@maintainx/shared'
import { MoreOptions } from '@/components/common/MoreOptions'
import { Button } from '@/components/ui/button'
import i18n from '@/i18n'
import { ApiError } from '@/services/http'
import { Form, NumberField, TextField, applyServerErrors, useZodForm } from './index'
import { translateIssue } from './zod-i18n'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

function messagesFor(schema: z.ZodType, input: unknown): string[] {
  const r = schema.safeParse(input)
  return r.success ? [] : r.error.issues.map((i) => i.message)
}

describe('translated Zod messages', () => {
  it('maps common issues to friendly text', () => {
    expect(messagesFor(z.string().min(1), '')).toEqual(['This field is required.'])
    expect(messagesFor(z.string().min(3), 'ab')).toEqual(['Must be at least 3 characters.'])
    expect(messagesFor(z.string().max(5), 'abcdef')).toEqual(['Must be at most 5 characters.'])
    expect(messagesFor(z.email(), 'nope')).toEqual(['Enter a valid email address.'])
    expect(messagesFor(z.number(), undefined)).toEqual(['This field is required.'])
    expect(messagesFor(z.number().int(), 1.5)).toEqual(['Enter a whole number.'])
    expect(messagesFor(z.number().min(5), 2)).toEqual(['Must be at least 5.'])
    expect(messagesFor(z.enum(['A', 'B']), '')).toEqual(['Please choose an option.'])
    expect(messagesFor(z.iso.date(), '2026-13-45')).toEqual(['Enter a valid date.'])
  })

  it('follows the UI language', async () => {
    await i18n.changeLanguage('hi')
    expect(messagesFor(z.string().min(1), '')).toEqual(['यह फ़ील्ड ज़रूरी है।'])
    await i18n.changeLanguage('gu')
    expect(messagesFor(z.string().min(3), 'a')).toEqual(['ઓછામાં ઓછા 3 અક્ષર હોવા જોઈએ.'])
  })

  it('schema-level keys from @maintainx/shared are left for FormMessage to translate', () => {
    expect(messagesFor(passwordSchema, 'abcdefgh')).toEqual(['validation.passwordNumber'])
  })

  it('translateIssue never returns a raw key', () => {
    const msg = translateIssue({ code: 'custom', input: 1, path: [], message: '' } as never)
    expect(msg).not.toMatch(/^validation\./)
  })
})

const schema = z.object({
  title: z.string().trim().min(3),
  password: passwordSchema,
  minutes: z.number().int().min(5).optional(),
})

function DemoForm({
  onSubmit,
}: {
  onSubmit: (form: ReturnType<typeof useZodForm<typeof schema>>) => Promise<void> | void
}) {
  const form = useZodForm(schema, {
    defaultValues: { title: '', password: '', minutes: undefined },
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(() => onSubmit(form))} noValidate>
        <TextField control={form.control} name="title" label="Title" required />
        <TextField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          required
        />
        <MoreOptions forceOpen={!!form.formState.errors.minutes}>
          <NumberField control={form.control} name="minutes" label="Minutes" optional />
        </MoreOptions>
        <Button type="submit">Save</Button>
      </form>
    </Form>
  )
}

describe('form fields', () => {
  it('shows translated, accessible errors and wires aria attributes', async () => {
    const user = userEvent.setup()
    render(<DemoForm onSubmit={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const title = screen.getByLabelText(/Title/)
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAttribute('aria-required', 'true')
    expect(await screen.findByText('Must be at least 3 characters.')).toBeInTheDocument()
    // Shared-schema key is translated at render time.
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument()
    const describedBy = title.getAttribute('aria-describedby') ?? ''
    expect(describedBy).toMatch(/-message/)
  })

  it('re-renders error text when the language changes', async () => {
    const user = userEvent.setup()
    render(<DemoForm onSubmit={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Must be at least 3 characters.')
    await i18n.changeLanguage('hi')
    await waitFor(() =>
      expect(screen.getByText('कम से कम 3 अक्षर होने चाहिए।')).toBeInTheDocument(),
    )
  })

  it('"More options" starts collapsed (hidden from view and screen readers) and toggles', async () => {
    const user = userEvent.setup()
    render(<DemoForm onSubmit={() => {}} />)
    expect(screen.getByLabelText(/Minutes/)).not.toBeVisible()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByLabelText(/Minutes/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Fewer options' }))
    expect(screen.getByLabelText(/Minutes/)).not.toBeVisible()
  })

  it('"More options" opens itself when a hidden field gets an error', async () => {
    const user = userEvent.setup()
    render(
      <DemoForm
        onSubmit={(form) => {
          applyServerErrors(
            form,
            new ApiError(400, 'VALIDATION_ERROR', 'x', { minutes: ['validation.invalidValue'] }),
          )
        }}
      />,
    )
    await user.type(screen.getByLabelText(/Title/), 'Fix fan')
    await user.type(screen.getByLabelText(/Password/), 'abcd1234')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByLabelText(/Minutes/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Fewer options' })).toBeDisabled()
  })

  it('maps API fieldErrors onto fields', async () => {
    const user = userEvent.setup()
    let applied: boolean | undefined
    render(
      <DemoForm
        onSubmit={(form) => {
          applied = applyServerErrors(
            form,
            new ApiError(409, 'CONFLICT', 'dup', {
              title: ['validation.alreadyInUse'],
              unknownField: ['x'],
            }),
          )
        }}
      />,
    )
    await user.type(screen.getByLabelText(/Title/), 'Walk-in freezer')
    await user.type(screen.getByLabelText(/Password/), 'abcd1234')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('This is already in use.')).toBeInTheDocument()
    expect(applied).toBe(true)
    expect(screen.getByLabelText(/Title/)).toHaveFocus()
  })

  it('applyServerErrors returns false for non-field errors', () => {
    const fakeForm = { getValues: () => ({}), setError: () => {} } as never
    expect(applyServerErrors(fakeForm, new Error('boom'))).toBe(false)
    expect(applyServerErrors(fakeForm, new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(false)
  })
})

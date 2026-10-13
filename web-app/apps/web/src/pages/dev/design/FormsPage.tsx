import { PRIORITY, WORK_ORDER_CATEGORY } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Callout } from '@/components/common/Callout'
import { MoreOptions } from '@/components/common/MoreOptions'
import { PageHeader } from '@/components/common/PageHeader'
import {
  DateField,
  Form,
  FormActions,
  FormRootError,
  NumberField,
  SelectField,
  SwitchField,
  TextareaField,
  TextField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { toast } from '@/components/ui/toaster'
import { ApiError } from '@/services/http'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'
import { DEMO_RESTAURANTS } from './demo-data'

// Same shape the real "New work order" form will use in Phase 9.
const demoSchema = z.object({
  title: z.string().trim().min(3).max(120),
  restaurant: z.string().min(1),
  priority: z.enum(PRIORITY),
  dueDate: z.iso.date().or(z.literal('')),
  description: z.string().trim().max(2000),
  category: z.enum(WORK_ORDER_CATEGORY).or(z.literal('')),
  estimatedMinutes: z.number().int().min(5).max(1440).optional(),
  notifyAssignee: z.boolean(),
})

type DemoValues = z.input<typeof demoSchema>

const DEFAULTS: DemoValues = {
  title: '',
  restaurant: '',
  priority: 'MEDIUM',
  dueDate: '',
  description: '',
  category: '',
  estimatedMinutes: undefined,
  notifyAssignee: true,
}

/** Stand-in for the API: rejects a duplicate title the way the server will (409 + fieldErrors). */
async function submitDemo(values: z.output<typeof demoSchema>) {
  await new Promise((r) => setTimeout(r, 700))
  if (values.title.toLowerCase().includes('duplicate')) {
    throw new ApiError(
      409,
      'CONFLICT',
      'Duplicate',
      { title: ['validation.alreadyInUse'] },
      'demo-1a2b3c',
    )
  }
  return values
}

export function FormsPage() {
  const { t } = useTranslation()
  const form = useZodForm(demoSchema, { defaultValues: DEFAULTS })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await submitDemo(values)
      toast.success('Work order created', { description: `${values.title} · ${values.restaurant}` })
      form.reset(DEFAULTS)
    } catch (err) {
      if (!applyServerErrors(form, err)) {
        form.setError('root', { message: describeError(err, t) })
      }
    }
  })

  const advancedHasError = Boolean(
    errors.category || errors.estimatedMinutes || errors.notifyAssignee,
  )

  return (
    <>
      <PageHeader
        title="Forms"
        description="React Hook Form + Zod. Validation messages follow the selected language; server field errors land on the right field."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,40rem)_1fr]">
        <Panel>
          <PanelHeader>
            <PanelTitle>New work order (demo, nothing is saved)</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <Form {...form}>
              <form onSubmit={onSubmit} noValidate className="grid gap-4">
                <FormRootError message={errors.root?.message} />
                <TextField
                  control={form.control}
                  name="title"
                  label="Title"
                  placeholder="e.g. Walk-in freezer not holding temperature"
                  required
                  autoComplete="off"
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    control={form.control}
                    name="restaurant"
                    label="Restaurant"
                    placeholder="Choose restaurant"
                    required
                    options={DEMO_RESTAURANTS.map((r) => ({ value: r, label: r }))}
                  />
                  <SelectField
                    control={form.control}
                    name="priority"
                    label="Priority"
                    required
                    options={PRIORITY.map((p) => ({
                      value: p,
                      label: enumLabel(t, 'priority', p),
                    }))}
                  />
                </div>
                <DateField control={form.control} name="dueDate" label="Due date" optional />
                <TextareaField
                  control={form.control}
                  name="description"
                  label="Description"
                  optional
                  rows={3}
                  placeholder="What's wrong, and where exactly?"
                />

                <MoreOptions forceOpen={advancedHasError}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      control={form.control}
                      name="category"
                      label="Category"
                      optional
                      placeholder="Choose category"
                      options={WORK_ORDER_CATEGORY.map((c) => ({
                        value: c,
                        label: enumLabel(t, 'workOrderCategory', c),
                      }))}
                    />
                    <NumberField
                      control={form.control}
                      name="estimatedMinutes"
                      label="Estimated time"
                      optional
                      min={5}
                      max={1440}
                      step={5}
                      suffix="min"
                    />
                  </div>
                  <SwitchField
                    control={form.control}
                    name="notifyAssignee"
                    label="Notify assignee"
                    description="Sends an in-app notification when the work order is assigned."
                  />
                </MoreOptions>

                <FormActions>
                  <Button
                    variant="secondary"
                    onClick={() => form.reset(DEFAULTS)}
                    disabled={isSubmitting}
                  >
                    {t('actions.reset')}
                  </Button>
                  <Button type="submit" loading={isSubmitting}>
                    {t('actions.create')}
                  </Button>
                </FormActions>
              </form>
            </Form>
          </PanelBody>
        </Panel>

        <div className="grid content-start gap-3">
          <Callout tone="info" title="Try this">
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>Submit empty: errors appear on blur, then update as you type.</li>
              <li>Switch to हिन्दी or ગુજરાતી: error messages change language.</li>
              <li>Type “duplicate” in the title: the simulated server returns a field error.</li>
              <li>
                In “More options”, enter 2 in Estimated time and click away: the section can’t be
                collapsed while a field inside has an error.
              </li>
            </ul>
          </Callout>
        </div>
      </div>
    </>
  )
}

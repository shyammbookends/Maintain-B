import {
  type PortalInfo,
  type PortalRequestStatus,
  type Priority,
} from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import { Camera, CheckCircle2, Search, X } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { z } from 'zod'
import { StatusBadge } from '@/components/common/StatusBadge'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormRootError,
  SelectField,
  TextField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BrandMark } from '@/layouts/BrandMark'
import { ApiError, http } from '@/services/http'
import { cn } from '@/utils/cn'
import { describeError } from '@/utils/errors'
import { formatDateTime } from '@/utils/format'
import { prepareUploads } from '@/utils/image'

const MAX_PHOTOS = 3
const NONE = '__none__'
const URGENCY: Array<{ value: Priority; key: 'urgencyNormal' | 'urgencyHigh' | 'urgencyCritical' }> =
  [
    { value: 'MEDIUM', key: 'urgencyNormal' },
    { value: 'HIGH', key: 'urgencyHigh' },
    { value: 'CRITICAL', key: 'urgencyCritical' },
  ]

const reportSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s().-]{7,20}$/, 'validation.phone'),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000),
  locationId: z.string(),
  priority: z.enum(['MEDIUM', 'HIGH', 'CRITICAL']),
  website: z.string(),
})

const statusSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s().-]{7,20}$/, 'validation.phone'),
})

/**
 * Public request portal (no login): opened from a restaurant's link or a
 * location's QR code. Guests report a problem and later check its status
 * with their phone number.
 */
export function RequestPortalPage() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const info = useQuery({
    queryKey: ['portal', token],
    queryFn: ({ signal }) =>
      http.get<{ data: PortalInfo }>(`/public/portal/${token}`, { signal }).then((r) => r.data),
    retry: false,
  })

  return (
    <div className="bg-app min-h-dvh">
      <header className="flex h-16 items-center justify-between px-4 sm:px-8">
        <BrandMark />
        <LanguageSwitcher />
      </header>
      <main id="main-content" className="mx-auto grid w-full max-w-xl gap-4 px-4 pb-12">
        {info.isPending ? (
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : info.isError ? (
          <Panel>
            <PanelBody className="grid gap-2 py-10 text-center">
              <h1 className="text-lg font-semibold">
                {info.error instanceof ApiError && info.error.status === 404
                  ? t('portal.notFound')
                  : t('portal.loadFailed')}
              </h1>
              <p className="text-sm text-muted-foreground">{t('portal.notFoundHint')}</p>
            </PanelBody>
          </Panel>
        ) : (
          <>
            <div>
              <p className="text-13 text-muted-foreground">{info.data.organization}</p>
              <h1 className="text-xl font-semibold tracking-tight">
                {info.data.restaurant.name}
                {info.data.location ? ` · ${info.data.location.name}` : ''}
              </h1>
            </div>
            <Tabs defaultValue="report">
              <TabsList className="w-full">
                <TabsTrigger value="report" className="flex-1">
                  {t('portal.tabReport')}
                </TabsTrigger>
                <TabsTrigger value="status" className="flex-1">
                  {t('portal.tabStatus')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="report">
                <ReportForm token={token} info={info.data} />
              </TabsContent>
              <TabsContent value="status">
                <StatusLookup token={token} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  )
}

function ReportForm({ token, info }: { token: string; info: PortalInfo }) {
  const { t } = useTranslation()
  const [sent, setSent] = useState<string | null>(null)
  const [photos, setPhotos] = useState<File[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const form = useZodForm(reportSchema, {
    defaultValues: {
      name: '',
      phone: '',
      title: '',
      description: '',
      locationId: info.location?.id ?? NONE,
      priority: 'MEDIUM',
      website: '',
    },
  })
  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  async function addPhotos(list: FileList | null) {
    if (!list) return
    const ready = await prepareUploads([...list].slice(0, MAX_PHOTOS - photos.length))
    setPhotos((p) => [...p, ...ready.filter((f) => f.type.startsWith('image/'))])
    if (fileInput.current) fileInput.current.value = ''
  }

  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    const body = new FormData()
    body.set('name', v.name)
    body.set('phone', v.phone)
    body.set('title', v.title)
    body.set('description', v.description)
    body.set('priority', v.priority)
    body.set('locationId', v.locationId === NONE ? '' : v.locationId)
    if (v.website) body.set('website', v.website)
    photos.forEach((p) => body.append('files', p))
    try {
      const res = await http.post<{ data: { code: string } }>(
        `/public/portal/${token}/requests`,
        body,
      )
      setSent(res.data.code)
      setPhotos([])
      form.reset({ ...form.getValues(), title: '', description: '', priority: 'MEDIUM' })
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  if (sent)
    return (
      <Panel className="mt-3">
        <PanelBody className="grid justify-items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-12 text-success" aria-hidden />
          <h2 className="text-lg font-semibold">{t('portal.sentTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('portal.sentBody', { code: sent })}</p>
          <Button variant="secondary" onClick={() => setSent(null)}>
            {t('portal.another')}
          </Button>
        </PanelBody>
      </Panel>
    )

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="mt-3 grid gap-5">
        <FormRootError message={errors.root?.message} />
        <TextField
          control={form.control}
          name="title"
          label={t('report.what')}
          placeholder={t('report.whatPlaceholder')}
          required
          maxLength={120}
          autoComplete="off"
        />
        {!info.location && info.locations.length > 0 && (
          <SelectField
            control={form.control}
            name="locationId"
            label={t('portal.where')}
            optional
            options={[
              { value: NONE, label: t('portal.anywhere') },
              ...info.locations.map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        )}
        <TextareaField
          control={form.control}
          name="description"
          label={t('report.describe')}
          placeholder={t('report.describePlaceholder')}
          optional
          rows={3}
          maxLength={2000}
        />
        <FormField
          control={form.control}
          name="priority"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('report.urgency')}</FormLabel>
              <FormControl>
                <RadioGroupPrimitive.Root
                  value={field.value}
                  onValueChange={field.onChange}
                  className="grid grid-cols-3 gap-2"
                >
                  {URGENCY.map((u) => (
                    <RadioGroupPrimitive.Item
                      key={u.value}
                      value={u.value}
                      className={cn(
                        'min-h-12 rounded-lg border px-2 text-sm font-medium',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                        u.value === 'CRITICAL'
                          ? 'data-[state=checked]:border-danger data-[state=checked]:bg-danger-soft data-[state=checked]:text-danger-fg'
                          : 'data-[state=checked]:border-primary data-[state=checked]:bg-info-soft',
                      )}
                    >
                      {t(`report.${u.key}`)}
                    </RadioGroupPrimitive.Item>
                  ))}
                </RadioGroupPrimitive.Root>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <section className="grid gap-2" aria-labelledby="portal-photos">
          <h2 id="portal-photos" className="text-sm font-medium">
            {t('portal.photos')}{' '}
            <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
          </h2>
          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {photos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="relative aspect-square">
                  <img src={previews[i]} alt="" className="size-full rounded-md border object-cover" />
                  <button
                    type="button"
                    aria-label={t('report.removePhoto', { n: i + 1 })}
                    onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-full bg-background/90 shadow focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            data-testid="portal-photo-input"
            onChange={(e) => void addPhotos(e.target.files)}
          />
          {photos.length < MAX_PHOTOS && (
            <Button
              variant="secondary"
              className="justify-start"
              onClick={() => fileInput.current?.click()}
            >
              <Camera aria-hidden /> {t('report.addPhoto')}
            </Button>
          )}
        </section>
        <fieldset className="grid gap-4 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">{t('portal.you')}</legend>
          <TextField
            control={form.control}
            name="name"
            label={t('portal.name')}
            required
            autoComplete="name"
          />
          <TextField
            control={form.control}
            name="phone"
            label={t('portal.phone')}
            description={t('portal.phoneHint')}
            required
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
        </fieldset>
        {/* Honeypot: hidden from people, filled by bots. */}
        <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" {...form.register('website')} />
          </label>
        </div>
        <Button type="submit" size="xl" loading={isSubmitting}>
          {t('report.send')}
        </Button>
      </form>
    </Form>
  )
}

function StatusLookup({ token }: { token: string }) {
  const { t } = useTranslation()
  const [results, setResults] = useState<PortalRequestStatus[] | null>(null)
  const form = useZodForm(statusSchema, { defaultValues: { phone: '' } })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await http.post<{ data: PortalRequestStatus[] }>(
        `/public/portal/${token}/status`,
        v,
      )
      setResults(res.data)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <div className="mt-3 grid gap-4">
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="grid gap-3">
          <FormRootError message={errors.root?.message} />
          <TextField
            control={form.control}
            name="phone"
            label={t('portal.phone')}
            description={t('portal.statusHint')}
            required
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
          <Button type="submit" loading={isSubmitting}>
            <Search aria-hidden /> {t('portal.check')}
          </Button>
        </form>
      </Form>
      {results &&
        (results.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            {t('portal.noneFound')}
          </p>
        ) : (
          <ul className="grid gap-2" aria-label={t('portal.tabStatus')}>
            {results.map((r) => (
              <li key={r.code} className="grid gap-1.5 rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-13 text-muted-foreground tabular">{r.code}</span>
                  {r.workOrderStatus ? (
                    <StatusBadge kind="workOrderStatus" value={r.workOrderStatus} />
                  ) : (
                    <StatusBadge kind="requestStatus" value={r.status} />
                  )}
                </div>
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t('portal.reportedAt', { time: formatDateTime(r.createdAt) })}
                </p>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

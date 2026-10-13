import {
  UPLOAD_MAX_FILES,
  guessCategory,
  type AssetDetail,
  type Priority,
  type WorkerRestaurant,
} from '@maintainx/shared'
import { Camera, X } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { ErrorState } from '@/components/common/ErrorState'
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
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { BottomActionBar } from '@/components/worker/BottomActionBar'
import { VoiceRecorder } from '@/components/work-orders/VoiceRecorder'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { useQueryClient } from '@tanstack/react-query'
import { assetMissingFrom, useAsset, useAssets } from '@/services/assets.service'
import { useWorkerRestaurants } from '@/services/worker.service'
import { requestsApi } from '@/services/work-orders.service'
import { cn } from '@/utils/cn'
import { describeError, isQueuedOffline } from '@/utils/errors'
import { prepareUploads } from '@/utils/image'

const NONE = '__none__'
/** Workers pick how bad it is in plain words; LOW isn't offered here. */
const URGENCY: Array<{
  value: Priority
  key: 'urgencyNormal' | 'urgencyHigh' | 'urgencyCritical'
}> = [
  { value: 'MEDIUM', key: 'urgencyNormal' },
  { value: 'HIGH', key: 'urgencyHigh' },
  { value: 'CRITICAL', key: 'urgencyCritical' },
]

const schema = z.object({
  restaurantId: z.string().min(1, 'validation.selectOption'),
  /** Typed freely, e.g. "Fridge not cooling"; becomes the request title. */
  problem: z.string().trim().min(3).max(120),
  assetId: z.string(),
  description: z.string().trim().min(5).max(2000),
  priority: z.enum(['MEDIUM', 'HIGH', 'CRITICAL']),
})

/**
 * "Report a problem": what kind (typed) → which equipment → what's wrong → photos.
 * Opening it from an asset (or its QR code) fills in the equipment.
 */
export function WorkerReportPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const assetId = params.get('assetId')
  const restaurants = useWorkerRestaurants()
  const asset = useAsset(assetId ?? '')
  const backTo = assetId ? `/w/assets/${assetId}` : '/w'

  const waitingForAsset = !!assetId && asset.isPending
  return (
    <>
      <WorkerPageHeader title={t('report.title')} backTo={backTo} />
      {restaurants.isError ? (
        <ErrorState error={restaurants.error} onRetry={() => void restaurants.refetch()} />
      ) : !restaurants.data || waitingForAsset ? (
        <div className="grid gap-3 p-4" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <ReportForm
          restaurants={restaurants.data}
          asset={assetId && asset.data ? asset.data : null}
          place={
            params.get('locationId') && params.get('restaurantId')
              ? { locationId: params.get('locationId')!, restaurantId: params.get('restaurantId')! }
              : null
          }
        />
      )}
    </>
  )
}

function ReportForm({
  restaurants,
  asset,
  place,
}: {
  /** Reported from a location QR code. */
  place: { locationId: string; restaurantId: string } | null
  restaurants: WorkerRestaurant[]
  asset: AssetDetail | null
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [photos, setPhotos] = useState<File[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  const form = useZodForm(schema, {
    defaultValues: {
      restaurantId:
        asset?.restaurant.id ??
        place?.restaurantId ??
        (restaurants.length === 1 ? restaurants[0]!.id : ''),
      problem: '',
      assetId: asset?.id ?? NONE,
      description: '',
      priority: 'MEDIUM',
    },
  })
  const restaurantId = form.watch('restaurantId')
  const assets = useAssets({ restaurantId, pageSize: 100, sort: 'name:asc' }, !!restaurantId)

  // Assets belong to one restaurant: picking another restaurant clears it.
  const assetRestaurant = useRef(restaurantId)
  useEffect(() => {
    if (assetRestaurant.current === restaurantId) return
    assetRestaurant.current = restaurantId
    form.setValue('assetId', NONE)
  }, [restaurantId, form])
  useEffect(() => {
    const a = form.getValues('assetId')
    // Only the first 100 assets are listed: a scanned asset beyond them is kept.
    if (a !== NONE && assets.data && assetMissingFrom(assets.data, a))
      form.setValue('assetId', NONE)
  }, [assets.data, form])
  const scanned = asset && asset.restaurant.id === restaurantId ? asset : null
  const assetOptions = [
    ...(assets.data?.data ?? []),
    ...(scanned && !assets.data?.data.some((x) => x.id === scanned.id) ? [scanned] : []),
  ]

  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  async function addPhotos(list: FileList | null) {
    if (!list) return
    const room = UPLOAD_MAX_FILES - photos.length
    const ready = await prepareUploads([...list].slice(0, room))
    setPhotos((p) => [...p, ...ready])
    if (fileInput.current) fileInput.current.value = ''
  }

  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const created = await requestsApi.create({
        restaurantId: v.restaurantId,
        locationId: place && place.restaurantId === v.restaurantId ? place.locationId : '',
        assetId: v.assetId === NONE ? '' : v.assetId,
        // Picked from the words used; an admin can change it when converting.
        category: guessCategory(`${v.problem} ${v.description}`),
        title: v.problem,
        description: v.description,
        priority: v.priority,
      })
      if (photos.length > 0) {
        try {
          await requestsApi.addPhotos(created.id, photos)
        } catch (err) {
          // The report is saved; say so, and why the photos weren't.
          toast.error(t('report.photosFailed', { reason: describeError(err, t) }))
        }
      }
      await qc.invalidateQueries({ queryKey: ['requests'] })
      toast.success(t('report.sent', { code: created.code }))
      navigate('/w/reports', { replace: true })
    } catch (err) {
      if (isQueuedOffline(err)) {
        // Stored on the device and sent when online; sending again would report it twice.
        toast.info(t('offline.queued'))
        navigate('/w/reports', { replace: true })
        return
      }
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-6 px-4 py-4">
        <FormRootError message={errors.root?.message} />

        {restaurants.length > 1 && (
          <SelectField
            control={form.control}
            name="restaurantId"
            label={t('report.where')}
            required
            placeholder={t('validation.selectOption')}
            options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
          />
        )}

        <TextField
          control={form.control}
          name="problem"
          label={t('report.what')}
          placeholder={t('report.whatPlaceholder')}
          required
          maxLength={120}
          autoComplete="off"
        />

        <SelectField
          control={form.control}
          name="assetId"
          label={t('report.which')}
          optional
          disabled={!restaurantId}
          options={[
            { value: NONE, label: t('report.noAsset') },
            ...assetOptions.map((a) => ({
              value: a.id,
              label: `${a.name}${a.location ? ` · ${a.location.name}` : ''}`,
            })),
          ]}
        />

        <TextareaField
          control={form.control}
          name="description"
          label={t('report.describe')}
          placeholder={t('report.describePlaceholder')}
          required
          rows={4}
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

        <section className="grid gap-2" aria-labelledby="report-photos">
          <h2 id="report-photos" className="text-sm font-medium">
            {t('report.photosAndVoice')}{' '}
            <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
          </h2>
          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {photos.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className={
                    f.type.startsWith('audio/')
                      ? 'relative col-span-3 flex items-center rounded-md border bg-muted/40 py-2 pr-11 pl-2'
                      : 'relative aspect-square'
                  }
                >
                  {f.type.startsWith('audio/') ? (
                    <audio controls src={previews[i]} className="h-9 w-full">
                      <track kind="captions" />
                    </audio>
                  ) : f.type.startsWith('image/') ? (
                    <img
                      src={previews[i]}
                      alt=""
                      className="size-full rounded-md border object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center rounded-md border text-xs text-muted-foreground">
                      {t('wo.video')}
                    </span>
                  )}
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
            accept="image/*,video/*"
            capture="environment"
            multiple
            hidden
            data-testid="report-photo-input"
            onChange={(e) => void addPhotos(e.target.files)}
          />
          {photos.length < UPLOAD_MAX_FILES && (
            <Button
              variant="secondary"
              size="xl"
              className="justify-start"
              onClick={() => fileInput.current?.click()}
            >
              <Camera aria-hidden /> {t('report.addPhoto')}
            </Button>
          )}
          {photos.length < UPLOAD_MAX_FILES && (
            <VoiceRecorder onRecorded={(file) => setPhotos((p) => [...p, file])} />
          )}
        </section>

        <BottomActionBar>
          <Button type="submit" size="xl" loading={isSubmitting}>
            {t('report.send')}
          </Button>
        </BottomActionBar>
      </form>
    </Form>
  )
}

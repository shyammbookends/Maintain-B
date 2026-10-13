import {
  LOCATION_TYPE,
  locationSchema,
  type LocationDto,
  type LocationInput,
} from '@maintainx/shared'
import {
  Building,
  DoorOpen,
  Download,
  Layers,
  MapPin,
  Pencil,
  Plus,
  QrCode as QrIcon,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { QrCode } from '@/components/assets/QrCode'
import { Can } from '@/components/common/Can'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import {
  Form,
  FormActions,
  FormRootError,
  SelectField,
  TextField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Panel } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation } from '@/hooks/useAdminQueries'
import { assetKeys, locationsApi, useLocations } from '@/services/assets.service'
import { cn } from '@/utils/cn'
import { describeError, reportError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'
import { downloadQrPng, locationQrUrl, portalUrl } from '@/utils/qr'
import { useWorkflow } from '@/contexts/WorkflowContext'

const TOP = '__top__'

const ICON: Partial<Record<LocationDto['type'], LucideIcon>> = {
  BUILDING: Building,
  FLOOR: Layers,
  ROOM: DoorOpen,
}

interface Node extends LocationDto {
  depth: number
}

/** Flattens the tree depth-first (parents before children, names in order). */
function flatten(rows: LocationDto[]): Node[] {
  const ids = new Set(rows.map((r) => r.id))
  const byParent = new Map<string | null, LocationDto[]>()
  for (const r of rows) {
    // An orphan (parent archived) shows at the top level instead of disappearing.
    const key = r.parentId && ids.has(r.parentId) ? r.parentId : null
    byParent.set(key, [...(byParent.get(key) ?? []), r])
  }
  const out: Node[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const r of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ ...r, depth })
      if (depth < 10) walk(r.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** Ids of a location and everything under it (it can't move below itself). */
function subtree(rows: LocationDto[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const r of rows)
      if (r.parentId && out.has(r.parentId) && !out.has(r.id)) {
        out.add(r.id)
        grew = true
      }
  }
  return out
}

const formSchema = locationSchema.extend({ parentId: z.string() })

function LocationForm({
  restaurantId,
  location,
  all,
  defaultParent,
  onDone,
}: {
  restaurantId: string
  location: LocationDto | null
  all: Node[]
  defaultParent?: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const form = useZodForm(formSchema, {
    defaultValues: location
      ? {
          restaurantId,
          parentId: location.parentId ?? TOP,
          name: location.name,
          type: location.type,
          description: location.description ?? '',
        }
      : {
          restaurantId,
          parentId: defaultParent ?? TOP,
          name: '',
          type: defaultParent ? 'ROOM' : 'KITCHEN',
          description: '',
        },
  })
  const save = useInvalidatingMutation(
    (v: LocationInput) => (location ? locationsApi.update(location.id, v) : locationsApi.create(v)),
    [assetKeys.locationsAll],
  )
  const blocked = location ? subtree(all, location.id) : new Set<string>()
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync({
        ...values,
        parentId: values.parentId === TOP ? '' : values.parentId,
      })
      toast.success(t('locations.saved'))
      onDone()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField
          control={form.control}
          name="name"
          label={t('locations.name')}
          required
          placeholder="Hot kitchen"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="type"
            label={t('locations.type')}
            options={LOCATION_TYPE.map((v) => ({
              value: v,
              label: enumLabel(t, 'locationType', v),
            }))}
          />
          <SelectField
            control={form.control}
            name="parentId"
            label={t('locations.parent')}
            description={t('locations.parentHint')}
            options={[
              { value: TOP, label: t('locations.topLevel') },
              ...all
                .filter((l) => !blocked.has(l.id))
                .map((l) => ({
                  value: l.id,
                  label: `${'— '.repeat(l.depth)}${l.name}`,
                })),
            ]}
          />
        </div>
        <TextField
          control={form.control}
          name="description"
          label={t('locations.description')}
          optional
        />
        <FormActions>
          <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('actions.save')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

export function LocationsPanel({ restaurantId }: { restaurantId: string }) {
  const { t } = useTranslation()
  const query = useLocations(restaurantId)
  const workflow = useWorkflow()
  const [editing, setEditing] = useState<LocationDto | { parent?: string } | null>(null)
  const [archiving, setArchiving] = useState<LocationDto | null>(null)
  const [qrFor, setQrFor] = useState<LocationDto | null>(null)
  const archive = useInvalidatingMutation(locationsApi.archive, [assetKeys.locationsAll])
  const tree = useMemo(() => flatten(query.data ?? []), [query.data])
  const hasChildren = useMemo(
    () => new Set((query.data ?? []).map((l) => l.parentId).filter(Boolean)),
    [query.data],
  )

  const addButton = (
    <Can permission="locations:create">
      <Button size="sm" onClick={() => setEditing({})}>
        <Plus aria-hidden /> {t('locations.new')}
      </Button>
    </Can>
  )
  const editingLocation = editing && 'id' in editing ? editing : null

  return (
    <>
      {query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      ) : query.data.length === 0 ? (
        <Panel>
          <EmptyState
            icon={MapPin}
            title={t('locations.emptyTitle')}
            description={t('locations.emptyBody')}
            action={addButton}
          />
        </Panel>
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-13 text-muted-foreground">{t('locations.treeHint')}</p>
            {addButton}
          </div>
          <Panel>
            <ul className="divide-y">
              {tree.map((l) => {
                const Icon = ICON[l.type] ?? MapPin
                const busy = l.assetCount > 0 || hasChildren.has(l.id)
                return (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-3 py-2.5 pr-4"
                    style={{ paddingLeft: 16 + l.depth * 24 }}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-lg',
                          l.depth === 0
                            ? 'bg-info-soft text-info-fg'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.name}</p>
                        <p className="truncate text-13 text-muted-foreground">
                          {enumLabel(t, 'locationType', l.type)} ·{' '}
                          {t('locations.assets', { count: l.assetCount })}
                          {l.description && ` · ${l.description}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Can permission="locations:create">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('locations.addInside', { name: l.name })}
                          title={t('locations.addInside', { name: l.name })}
                          onClick={() => setEditing({ parent: l.id })}
                        >
                          <Plus />
                        </Button>
                      </Can>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('locations.qr', { name: l.name })}
                        title={t('locations.qr', { name: l.name })}
                        onClick={() => setQrFor(l)}
                      >
                        <QrIcon />
                      </Button>
                      <Can permission="locations:edit">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t('actions.edit')}: ${l.name}`}
                          onClick={() => setEditing(l)}
                        >
                          <Pencil />
                        </Button>
                      </Can>
                      <Can permission="locations:delete">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t('locations.archive')}: ${l.name}`}
                          title={busy ? t('locations.inUse') : undefined}
                          disabled={busy}
                          onClick={() => setArchiving(l)}
                        >
                          <Trash2 />
                        </Button>
                      </Can>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Panel>
        </div>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>
              {editingLocation ? t('locations.editTitle') : t('locations.createTitle')}
            </SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing !== null && (
              <LocationForm
                restaurantId={restaurantId}
                location={editingLocation}
                all={tree}
                defaultParent={editing && !('id' in editing) ? editing.parent : undefined}
                onDone={() => setEditing(null)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Dialog open={qrFor !== null} onOpenChange={(o) => !o && setQrFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{qrFor?.name}</DialogTitle>
            <DialogDescription>{t('locations.qrHint')}</DialogDescription>
          </DialogHeader>
          {qrFor && (
            <div className="grid justify-items-center gap-3">
              <QrCode
                value={locationQrUrl(qrFor.publicId)}
                label={t('locations.qr', { name: qrFor.name })}
                className="w-48"
              />
              <Button
                variant="secondary"
                onClick={() =>
                  void downloadQrPng(locationQrUrl(qrFor.publicId), `location-${qrFor.name}.png`)
                }
              >
                <Download aria-hidden /> {t('assets.downloadPng')}
              </Button>
              {workflow?.requestPortal && (
                <div className="mt-2 grid justify-items-center gap-3 border-t pt-4 text-center">
                  <p className="text-13 text-muted-foreground">{t('portal.locationQrHint')}</p>
                  <QrCode
                    value={portalUrl(qrFor.publicId)}
                    label={t('portal.qrLabel', { name: qrFor.name })}
                    className="w-48"
                  />
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void downloadQrPng(
                        portalUrl(qrFor.publicId),
                        `report-a-problem-${qrFor.name}.png`,
                      )
                    }
                  >
                    <Download aria-hidden /> {t('portal.downloadGuestQr')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        tone="destructive"
        title={t('locations.archiveTitle', { name: archiving?.name ?? '' })}
        description={t('locations.archiveBody')}
        confirmLabel={t('locations.archive')}
        onConfirm={async () => {
          try {
            await archive.mutateAsync(archiving!.id)
            toast.success(t('locations.archived'))
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

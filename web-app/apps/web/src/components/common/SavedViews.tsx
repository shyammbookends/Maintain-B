import type { SavedViewDto, SavedViewResource } from '@maintainx/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, BookmarkPlus, Check, ChevronDown, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { z } from 'zod'
import {
  CheckboxField,
  Form,
  FormActions,
  FormRootError,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/contexts/AuthContext'
import { http } from '@/services/http'
import { describeError, reportError } from '@/utils/errors'

const key = (resource: SavedViewResource) => ['saved-views', resource] as const

/** The list's filters without paging: what a view stores and compares. */
function viewQuery(params: URLSearchParams): string {
  const p = new URLSearchParams(params)
  p.delete('page')
  p.delete('open')
  p.sort()
  return p.toString()
}

/**
 * Saved views for a list page: name the current filters, sort and search
 * (they live in the URL) and open them again in one click. Private by
 * default; shared views show for everyone who can open the list.
 */
export function SavedViews({ resource }: { resource: SavedViewResource }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [saving, setSaving] = useState(false)
  const views = useQuery({
    queryKey: key(resource),
    queryFn: ({ signal }) =>
      http
        .get<{ data: SavedViewDto[] }>('/saved-views', { query: { resource }, signal })
        .then((r) => r.data),
    staleTime: 60_000,
  })
  const current = viewQuery(params)
  const active = views.data?.find((v) => viewQuery(new URLSearchParams(v.query)) === current)

  async function remove(v: SavedViewDto) {
    try {
      const next = await http.delete<{ data: SavedViewDto[] }>(`/saved-views/${v.id}`)
      qc.setQueryData(key(resource), next.data)
      toast.success(t('views.deleted', { name: v.name }))
    } catch (err) {
      reportError(err, t)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            <Bookmark aria-hidden />
            <span className="max-w-40 truncate">{active ? active.name : t('views.title')}</span>
            <ChevronDown className="size-4 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>{t('views.title')}</DropdownMenuLabel>
          {(views.data ?? []).length === 0 ? (
            <p className="px-2 py-1.5 text-13 text-muted-foreground">{t('views.none')}</p>
          ) : (
            views.data!.map((v) => (
              <DropdownMenuItem
                key={v.id}
                onSelect={() => setParams(new URLSearchParams(v.query))}
                className="group"
              >
                {v === active ? (
                  <Check className="size-4" aria-hidden />
                ) : v.shared ? (
                  <Users className="size-4 text-muted-foreground" aria-hidden />
                ) : (
                  <Bookmark className="size-4 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                {(v.mine || can('settings:edit')) && (
                  <button
                    type="button"
                    aria-label={t('views.delete', { name: v.name })}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      void remove(v)
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-danger-soft hover:text-danger-fg focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaving(true)} disabled={!current}>
            <BookmarkPlus className="size-4" aria-hidden /> {t('views.save')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('views.saveTitle')}</DialogTitle>
            <DialogDescription>{t('views.saveHint')}</DialogDescription>
          </DialogHeader>
          {saving && (
            <SaveForm
              resource={resource}
              query={current}
              onDone={(list) => {
                qc.setQueryData(key(resource), list)
                setSaving(false)
              }}
              onCancel={() => setSaving(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

const saveSchema = z.object({ name: z.string().trim().min(1).max(60), shared: z.boolean() })

function SaveForm({
  resource,
  query,
  onDone,
  onCancel,
}: {
  resource: SavedViewResource
  query: string
  onDone: (list: SavedViewDto[]) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const form = useZodForm(saveSchema, { defaultValues: { name: '', shared: false } })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await http.post<{ data: SavedViewDto[] }>('/saved-views', {
        resource,
        query,
        ...v,
      })
      toast.success(t('views.saved', { name: v.name }))
      onDone(res.data)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField control={form.control} name="name" label={t('views.name')} required autoFocus />
        <CheckboxField
          control={form.control}
          name="shared"
          label={t('views.shared')}
          description={t('views.sharedHint')}
        />
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
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

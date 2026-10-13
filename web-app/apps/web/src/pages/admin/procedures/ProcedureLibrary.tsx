import {
  PROCEDURE_LIBRARY,
  isLocale,
  type ApiResponse,
  type LibraryProcedure,
  type ProcedureDetail,
} from '@maintainx/shared'
import { BookOpen, Check, Layers } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'
import { useCurrentUser } from '@/contexts/AuthContext'
import { useInvalidatingMutation } from '@/hooks/useAdminQueries'
import { http } from '@/services/http'
import { mxKeys } from '@/services/maintenance.service'
import { reportError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

/**
 * Ready-made restaurant procedures (cooler check, hood filters, gas safety…).
 * Adding one copies it in the current language; it can then be edited.
 */
export function ProcedureLibraryButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <BookOpen aria-hidden /> {t('library.open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('library.title')}</DialogTitle>
            <DialogDescription>{t('library.hint')}</DialogDescription>
          </DialogHeader>
          {open && <LibraryList />}
        </DialogContent>
      </Dialog>
    </>
  )
}

function LibraryList() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const locale = isLocale(i18n.language) ? i18n.language : 'en'
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<Record<string, string>>({})
  const add = useInvalidatingMutation(
    (key: string) =>
      http
        .post<ApiResponse<ProcedureDetail>>(`/procedures/library/${key}`, {
          locale,
          // Admins limited to their restaurants add it to the first one; Super Admins for all.
          restaurantId: user.isSuperAdmin ? '' : (user.restaurants[0]?.id ?? ''),
        })
        .then((r) => r.data),
    [mxKeys.procedures],
  )

  async function copy(entry: LibraryProcedure) {
    setBusy(entry.key)
    try {
      const p = await add.mutateAsync(entry.key)
      setAdded((a) => ({ ...a, [entry.key]: p.id }))
      toast.success(t('library.added', { name: p.name }))
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(null)
    }
  }

  return (
    <ul className="grid max-h-[60vh] gap-2 overflow-y-auto pr-1">
      {PROCEDURE_LIBRARY.map((entry) => {
        const steps = entry.steps.filter((s) => s.inputType !== 'SECTION').length
        const conditional = entry.steps.some((s) => s.showIf)
        return (
          <li key={entry.key} className="flex items-start gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{entry.name[locale]}</p>
              <p className="text-13 text-muted-foreground">{entry.description[locale]}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge tone="outline">{enumLabel(t, 'workOrderCategory', entry.category)}</Badge>
                <Badge tone="neutral">{t('library.steps', { count: steps })}</Badge>
                {conditional && (
                  <Badge tone="info">
                    <Layers aria-hidden /> {t('library.conditional')}
                  </Badge>
                )}
              </div>
            </div>
            {added[entry.key] ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/procedures/${added[entry.key]}`)}
              >
                <Check aria-hidden /> {t('library.openAdded')}
              </Button>
            ) : (
              <Button
                size="sm"
                loading={busy === entry.key}
                disabled={busy !== null}
                aria-label={t('library.addNamed', { name: entry.name[locale] })}
                onClick={() => void copy(entry)}
              >
                {t('library.add')}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

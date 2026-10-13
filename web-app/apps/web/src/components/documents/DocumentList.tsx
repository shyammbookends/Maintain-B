import type { DocumentDto, DocumentOwnerType } from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Can } from '@/components/common/Can'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { documentsApi, platformKeys, useDocuments } from '@/services/platform.service'
import { reportError } from '@/utils/errors'
import { formatDate, formatNumber } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { EditDocumentDialog, UploadDocumentDialog } from './DocumentDialogs'

const size = (b: number) =>
  b >= 1024 * 1024
    ? `${formatNumber(b / 1024 / 1024, { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(b / 1024))} KB`

export function ExpiryBadge({ doc }: { doc: Pick<DocumentDto, 'expiry' | 'expiresAt'> }) {
  const { t } = useTranslation()
  if (doc.expiry === 'expired')
    return (
      <Badge tone="danger" dot>
        {t('documents.expired')}
      </Badge>
    )
  if (doc.expiry === 'expiring')
    return (
      <Badge tone="warning" dot>
        {t('documents.expiresOn', { date: formatDate(`${doc.expiresAt}T00:00:00`) })}
      </Badge>
    )
  return null
}

/** Rows of documents with open / download / edit / delete. */
export function DocumentRows({
  docs,
  showOwner = false,
  onChanged,
}: {
  docs: DocumentDto[]
  showOwner?: boolean
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<DocumentDto | null>(null)
  const [deleting, setDeleting] = useState<DocumentDto | null>(null)
  return (
    <>
      <ul className="divide-y">
        {docs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm font-medium text-primary hover:underline"
              >
                {d.title}
              </a>
              <span className="block truncate text-xs text-muted-foreground">
                {enumLabel(t, 'documentType', d.docType)}
                {showOwner && ` · ${d.owner.name}`}
                {` · ${size(d.sizeBytes)}`}
                {d.expiresAt &&
                  d.expiry === 'valid' &&
                  ` · ${t('documents.validUntil', { date: formatDate(`${d.expiresAt}T00:00:00`) })}`}
              </span>
            </span>
            <ExpiryBadge doc={d} />
            <span className="flex gap-0.5">
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                aria-label={t('documents.downloadNamed', { name: d.title })}
              >
                <a href={d.downloadUrl}>
                  <Download />
                </a>
              </Button>
              {d.can.edit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('documents.editNamed', { name: d.title })}
                  onClick={() => setEditing(d)}
                >
                  <Pencil />
                </Button>
              )}
              {d.can.delete && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('documents.deleteNamed', { name: d.title })}
                  onClick={() => setDeleting(d)}
                >
                  <Trash2 />
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {editing && (
        <EditDocumentDialog doc={editing} onClose={() => setEditing(null)} onSaved={onChanged} />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        tone="destructive"
        title={t('documents.deleteTitle', { name: deleting?.title ?? '' })}
        description={t('documents.deleteBody')}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          try {
            await documentsApi.archive(deleting!.id)
            onChanged()
            toast.success(t('documents.deleted'))
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

/** Documents belonging to one record (asset, restaurant, vendor, work order). */
export function DocumentsPanel({
  ownerType,
  ownerId,
  ownerName,
  readOnly = false,
}: {
  ownerType: DocumentOwnerType
  ownerId: string
  ownerName: string
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const query = useDocuments({ ownerType, ownerId, pageSize: 100 })
  const refresh = () => void qc.invalidateQueries({ queryKey: platformKeys.documents })
  return (
    <div className="grid gap-2">
      {!readOnly && (
        <Can permission="documents:create">
          <Button
            size="sm"
            variant="secondary"
            className="justify-self-start"
            onClick={() => setUploading(true)}
          >
            <Plus aria-hidden /> {t('documents.upload')}
          </Button>
        </Can>
      )}
      {query.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (query.data?.data.length ?? 0) === 0 ? (
        <p className="text-13 text-muted-foreground">{t('documents.noneHere')}</p>
      ) : (
        <div className="-mx-4">
          <DocumentRows docs={query.data!.data} onChanged={refresh} />
        </div>
      )}
      {!readOnly && (
        <UploadDocumentDialog
          ownerType={ownerType}
          ownerId={ownerId}
          ownerName={ownerName}
          open={uploading}
          onOpenChange={setUploading}
          onUploaded={refresh}
        />
      )}
    </div>
  )
}

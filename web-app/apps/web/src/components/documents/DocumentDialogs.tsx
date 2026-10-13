import {
  DOCUMENT_TYPE,
  documentMetaSchema,
  type DocumentDto,
  type DocumentOwnerType,
} from '@maintainx/shared'
import { FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DateField,
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
import { toast } from '@/components/ui/toaster'
import { documentsApi } from '@/services/platform.service'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx'

/** Pick a file, describe it (type, dates), upload. */
export function UploadDocumentDialog({
  ownerType,
  ownerId,
  ownerName,
  open,
  onOpenChange,
  onUploaded,
}: {
  ownerType: DocumentOwnerType
  ownerId: string
  ownerName: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onUploaded: (d: DocumentDto) => void
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const form = useZodForm(documentMetaSchema, {
    defaultValues: { title: '', docType: 'OTHER', issuedAt: '', expiresAt: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    if (!file) {
      setFileError(t('validation.required'))
      return
    }
    try {
      const doc = await documentsApi.upload({ ownerType, ownerId, ...v }, file)
      toast.success(t('documents.uploaded'))
      form.reset()
      setFile(null)
      onUploaded(doc)
      onOpenChange(false)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('documents.upload')}</DialogTitle>
          <DialogDescription>{ownerName}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <div className="grid gap-1.5">
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                hidden
                data-testid="document-file"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setFile(f)
                  setFileError(null)
                  if (f && !form.getValues('title'))
                    form.setValue('title', f.name.replace(/\.[^.]*$/, ''))
                }}
              />
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => input.current?.click()}
              >
                <FileUp aria-hidden /> {file ? file.name : t('documents.chooseFile')}
              </Button>
              <p className={fileError ? 'text-13 text-danger-fg' : 'text-xs text-muted-foreground'}>
                {fileError ?? t('documents.fileHint')}
              </p>
            </div>
            <TextField control={form.control} name="title" label={t('documents.title')} required />
            <SelectField
              control={form.control}
              name="docType"
              label={t('documents.type')}
              options={DOCUMENT_TYPE.map((d) => ({
                value: d,
                label: enumLabel(t, 'documentType', d),
              }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <DateField
                control={form.control}
                name="issuedAt"
                label={t('documents.issued')}
                optional
              />
              <DateField
                control={form.control}
                name="expiresAt"
                label={t('documents.expires')}
                description={t('documents.expiresHint')}
                optional
              />
            </div>
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('documents.upload')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function EditDocumentDialog({
  doc,
  onClose,
  onSaved,
}: {
  doc: DocumentDto
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const form = useZodForm(documentMetaSchema, {
    defaultValues: {
      title: doc.title,
      docType: doc.docType,
      issuedAt: doc.issuedAt ?? '',
      expiresAt: doc.expiresAt ?? '',
    },
  })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await documentsApi.update(doc.id, v)
      toast.success(t('documents.saved'))
      onSaved()
      onClose()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('documents.edit')}</DialogTitle>
          <DialogDescription>{doc.fileName}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <TextField control={form.control} name="title" label={t('documents.title')} required />
            <SelectField
              control={form.control}
              name="docType"
              label={t('documents.type')}
              options={DOCUMENT_TYPE.map((d) => ({
                value: d,
                label: enumLabel(t, 'documentType', d),
              }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <DateField
                control={form.control}
                name="issuedAt"
                label={t('documents.issued')}
                optional
              />
              <DateField
                control={form.control}
                name="expiresAt"
                label={t('documents.expires')}
                optional
              />
            </div>
            <FormActions>
              <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('actions.save')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

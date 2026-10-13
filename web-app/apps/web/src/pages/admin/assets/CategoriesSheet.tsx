import { assetCategorySchema } from '@maintainx/shared'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Can } from '@/components/common/Can'
import { Form, FormRootError, TextField, applyServerErrors, useZodForm } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation } from '@/hooks/useAdminQueries'
import { assetKeys, categoriesApi, useAssetCategories } from '@/services/assets.service'
import { describeError, reportError } from '@/utils/errors'

/** Add categories and archive unused ones. Categories are shared by all restaurants. */
export function CategoriesSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { t } = useTranslation()
  const categories = useAssetCategories()
  const form = useZodForm(assetCategorySchema, { defaultValues: { name: '' } })
  const create = useInvalidatingMutation(categoriesApi.create, [assetKeys.categories])
  const archive = useInvalidatingMutation(categoriesApi.archive, [assetKeys.categories])

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values)
      toast.success(t('assets.categorySaved'))
      form.reset({ name: '' })
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{t('assets.categoriesTitle')}</SheetTitle>
        </SheetHeader>
        <SheetBody className="grid content-start gap-4">
          <Can permission="assets:create">
            <Form {...form}>
              <form onSubmit={onSubmit} noValidate className="flex items-start gap-2">
                <FormRootError message={form.formState.errors.root?.message} />
                <TextField
                  control={form.control}
                  name="name"
                  label={t('assets.categoryName')}
                  className="flex-1"
                />
                <Button type="submit" className="mt-6" loading={form.formState.isSubmitting}>
                  {t('assets.addCategory')}
                </Button>
              </form>
            </Form>
          </Can>
          <ul className="divide-y rounded-md border">
            {(categories.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{c.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-13 text-muted-foreground tabular">{c.assetCount}</span>
                  <Can permission="assets:delete">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t('assets.archiveCategory')}: ${c.name}`}
                      disabled={c.assetCount > 0}
                      onClick={async () => {
                        try {
                          await archive.mutateAsync(c.id)
                          toast.success(t('assets.categoryArchived'))
                        } catch (err) {
                          reportError(err, t)
                        }
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </Can>
                </span>
              </li>
            ))}
          </ul>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

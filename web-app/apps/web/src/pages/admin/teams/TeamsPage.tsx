import { teamSchema, type TeamDto, type TeamInput } from '@maintainx/shared'
import { Plus, Trash2, UsersRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Can } from '@/components/common/Can'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { CheckboxListField } from '@/components/forms/CheckboxListField'
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
import { Panel } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/contexts/AuthContext'
import {
  adminKeys,
  useInvalidatingMutation,
  useRestaurants,
  useTeams,
  useUserOptions,
} from '@/hooks/useAdminQueries'
import { teamsApi } from '@/services/admin.service'
import { describeError, reportError } from '@/utils/errors'
import { CardList, ListCard as MListCard, MPill as MobilePill } from '@/components/mobile/kit'
import { usePhone } from '@/hooks/usePhone'
import { UsersRound as MUsersRound } from 'lucide-react'

/** Select fields can't hold null; this sentinel stands for "organization-wide" / "no lead". */
const NONE = '__none__'

/** Form shape: selects hold strings, so null is represented by NONE. */
const teamFormSchema = z.object({
  name: teamSchema.shape.name,
  description: teamSchema.shape.description,
  restaurantId: z.string().min(1),
  leadUserId: z.string(),
  memberIds: teamSchema.shape.memberIds,
})
type TeamFormValues = z.infer<typeof teamFormSchema>

function toInput(v: TeamFormValues): TeamInput {
  return {
    name: v.name,
    description: v.description,
    restaurantId: v.restaurantId === NONE ? null : v.restaurantId,
    leadUserId: v.leadUserId === NONE ? null : v.leadUserId,
    memberIds: v.memberIds,
  }
}

function TeamForm({ team, onDone }: { team: TeamDto | null; onDone: () => void }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const restaurants = useRestaurants()
  const [confirmArchive, setConfirmArchive] = useState(false)

  const form = useZodForm(teamFormSchema, {
    defaultValues: {
      name: team?.name ?? '',
      description: team?.description ?? '',
      restaurantId: team ? (team.restaurant?.id ?? NONE) : (restaurants.data?.[0]?.id ?? ''),
      leadUserId: team?.lead?.id ?? NONE,
      memberIds: team?.members.map((m) => m.id) ?? [],
    },
  })
  const restaurantId = form.watch('restaurantId')
  const memberIds = form.watch('memberIds')
  const candidates = useUserOptions(
    restaurantId && restaurantId !== NONE ? restaurantId : undefined,
    restaurantId !== '',
  )

  // Members of another restaurant aren't valid after switching restaurants.
  useEffect(() => {
    if (!candidates.data) return
    const ids = new Set(candidates.data.map((c) => c.id))
    const current = form.getValues('memberIds')
    const kept = current.filter((id) => ids.has(id))
    if (kept.length !== current.length) form.setValue('memberIds', kept)
  }, [candidates.data, form])

  const save = useInvalidatingMutation(
    (input: TeamInput) => (team ? teamsApi.update(team.id, input) : teamsApi.create(input)),
    [adminKeys.teams, adminKeys.users],
  )
  const archive = useInvalidatingMutation(
    () => teamsApi.archive(team!.id),
    [adminKeys.teams, adminKeys.users],
  )
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(toInput(values))
      toast.success(t('teams.saved'))
      onDone()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  const restaurantOptions = [
    ...(user?.isSuperAdmin ? [{ value: NONE, label: t('teams.orgWide') }] : []),
    ...(restaurants.data ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` })),
  ]
  const memberOptions = (candidates.data ?? []).map((c) => ({
    value: c.id,
    label: `${c.firstName} ${c.lastName}`,
    description: c.role ?? undefined,
  }))
  const leadOptions = [
    { value: NONE, label: t('teams.noLead') },
    ...memberOptions
      .filter((o) => memberIds.includes(o.value))
      .map(({ value, label }) => ({ value, label })),
  ]

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField control={form.control} name="name" label={t('teams.name')} required />
        <TextField
          control={form.control}
          name="description"
          label={t('teams.description')}
          optional
        />
        <SelectField
          control={form.control}
          name="restaurantId"
          label={t('teams.restaurant')}
          required
          options={restaurantOptions}
          placeholder={t('validation.selectOption')}
        />
        <CheckboxListField
          control={form.control}
          name="memberIds"
          label={t('teams.members')}
          description={t('teams.membersHint')}
          emptyMessage={t('teams.noCandidates')}
          options={memberOptions}
        />
        <SelectField
          control={form.control}
          name="leadUserId"
          label={t('teams.lead')}
          options={leadOptions}
        />
        <FormActions className="justify-between sm:justify-between">
          <div>
            {team && (
              <Can permission="teams:delete">
                <Button variant="destructive-outline" onClick={() => setConfirmArchive(true)}>
                  <Trash2 aria-hidden /> {t('teams.archive')}
                </Button>
              </Can>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {t('actions.save')}
            </Button>
          </div>
        </FormActions>
      </form>
      {team && (
        <ConfirmDialog
          open={confirmArchive}
          onOpenChange={setConfirmArchive}
          tone="destructive"
          title={t('teams.archiveTitle', { name: team.name })}
          description={t('teams.archiveBody')}
          confirmLabel={t('teams.archive')}
          onConfirm={async () => {
            try {
              await archive.mutateAsync()
              toast.success(t('teams.archived'))
              onDone()
            } catch (err) {
              reportError(err, t)
              throw err
            }
          }}
        />
      )}
    </Form>
  )
}

export function TeamsPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const query = useTeams()
  const [editing, setEditing] = useState<TeamDto | 'new' | null>(null)
  const phone = usePhone()
  const canEdit = can('teams:edit')

  return (
    <>
      <PageHeader
        title={t('teams.title')}
        description={t('teams.subtitle')}
        actions={
          <Can permission="teams:create">
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> {t('teams.new')}
            </Button>
          </Can>
        }
      />
      {phone && (query.data?.length ?? 0) > 0 ? (
        <CardList>
          {(query.data ?? []).map((team) => (
            <li key={team.id} className="min-w-0">
              <MListCard
                onClick={canEdit ? () => setEditing(team) : undefined}
                leading={
                  <span className="m-brand flex size-[38px] shrink-0 items-center justify-center rounded-[11px] text-white">
                    <MUsersRound className="size-5" aria-hidden />
                  </span>
                }
                title={team.name}
                lines={[
                  team.description,
                  [
                    team.restaurant?.name ?? t('teams.orgWide'),
                    team.lead ? `${team.lead.firstName} ${team.lead.lastName}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ]}
                trailing={<MobilePill tone="info">{team.members.length}</MobilePill>}
              />
            </li>
          ))}
        </CardList>
      ) : (
        <Panel className="overflow-hidden">
          {query.isPending ? (
            <div className="grid gap-3 p-4" aria-busy="true">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
          ) : query.data.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={t('teams.emptyTitle')}
              description={t('teams.emptyBody')}
              action={
                <Can permission="teams:create">
                  <Button size="sm" onClick={() => setEditing('new')}>
                    <Plus aria-hidden /> {t('teams.new')}
                  </Button>
                </Can>
              }
            />
          ) : (
            <Table aria-label={t('teams.title')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('teams.colName')}</TableHead>
                  <TableHead>{t('teams.colRestaurant')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('teams.colLead')}</TableHead>
                  <TableHead className="text-right">{t('teams.colMembers')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((team) => (
                  <TableRow
                    key={team.id}
                    data-clickable={canEdit || undefined}
                    tabIndex={canEdit ? 0 : undefined}
                    onClick={canEdit ? () => setEditing(team) : undefined}
                    onKeyDown={canEdit ? (e) => e.key === 'Enter' && setEditing(team) : undefined}
                  >
                    <TableCell>
                      <p className="font-medium">{team.name}</p>
                      {team.description && (
                        <p className="text-13 text-muted-foreground">{team.description}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {team.restaurant?.name ?? t('teams.orgWide')}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {team.lead ? `${team.lead.firstName} ${team.lead.lastName}` : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular">{team.members.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      )}

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>
              {editing === 'new' ? t('teams.createTitle') : t('teams.editTitle')}
            </SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing !== null && (
              <TeamForm team={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}

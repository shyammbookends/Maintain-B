import {
  SYSTEM_ROLES,
  fullName,
  updateUserAccessSchema,
  updateUserSchema,
  type UpdateUserAccessInput,
  type UpdateUserInput,
  type UserDetail,
} from '@maintainx/shared'
import {
  KeyRound,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  Trash2,
  Unlock,
  UserCheck,
  UserX,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { UserAccessFields } from '@/components/admin/UserAccessFields'
import { Callout } from '@/components/common/Callout'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { DetailList } from '@/components/common/DetailList'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import {
  Form,
  FormActions,
  FormRootError,
  TextField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { adminKeys, useInvalidatingMutation, useUser } from '@/hooks/useAdminQueries'
import { usersApi } from '@/services/admin.service'
import { describeError, reportError } from '@/utils/errors'
import { formatCurrency, formatDate, formatRelative } from '@/utils/format'
import { TempPasswordDialog, type TempPassword } from './TempPasswordDialog'

type Confirm = 'disable' | 'reset' | 'archive' | null
type SheetKind = 'profile' | 'access' | null

function ProfileForm({ user, onDone }: { user: UserDetail; onDone: () => void }) {
  const { t } = useTranslation()
  const form = useZodForm(updateUserSchema, {
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email ?? '',
      username: user.username ?? '',
      phone: user.phone ?? '',
      jobTitle: user.jobTitle ?? '',
      hourlyRate: user.hourlyRate ?? '',
    },
  })
  const save = useInvalidatingMutation(
    (v: UpdateUserInput) => usersApi.update(user.id, v),
    [adminKeys.users],
  )
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values)
      toast.success(t('users.profileSaved'))
      onDone()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="firstName"
            label={t('users.firstName')}
            required
          />
          <TextField control={form.control} name="lastName" label={t('users.lastName')} required />
        </div>
        <p className="text-xs text-muted-foreground">{t('users.identifiersHint')}</p>
        <TextField control={form.control} name="email" type="email" label={t('users.email')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="username"
            label={t('users.username')}
            autoCapitalize="none"
          />
          <TextField control={form.control} name="phone" type="tel" label={t('users.phone')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="jobTitle"
            label={t('users.jobTitle')}
            placeholder={t('users.jobTitlePlaceholder')}
            optional
          />
          <TextField
            control={form.control}
            name="hourlyRate"
            label={t('users.hourlyRate')}
            description={t('users.hourlyRateHint')}
            inputMode="decimal"
            placeholder="₹"
            optional
          />
        </div>
        <FormActions>
          <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('actions.saveChanges')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

function AccessForm({ user, onDone }: { user: UserDetail; onDone: () => void }) {
  const { t } = useTranslation()
  const form = useZodForm(updateUserAccessSchema, {
    defaultValues: {
      roleId: user.role?.id ?? '',
      restaurantIds: user.restaurants.map((r) => r.id),
    },
  })
  const save = useInvalidatingMutation(
    (v: UpdateUserAccessInput) => usersApi.updateAccess(user.id, v),
    [adminKeys.users, adminKeys.roles],
  )
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values)
      toast.success(t('users.accessSaved'))
      onDone()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <UserAccessFields control={form.control} />
        <FormActions>
          <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('actions.saveChanges')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

export function UserDetailPage() {
  const { t } = useTranslation()
  const { userId = '' } = useParams()
  const navigate = useNavigate()
  const query = useUser(userId)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [tempPassword, setTempPassword] = useState<TempPassword | null>(null)

  const setStatus = useInvalidatingMutation(
    (status: 'ACTIVE' | 'DISABLED') => usersApi.setStatus(userId, { status }),
    [adminKeys.users],
  )
  const reset = useInvalidatingMutation(() => usersApi.resetPassword(userId), [adminKeys.users])
  const archive = useInvalidatingMutation(
    () => usersApi.archive(userId),
    [adminKeys.users, adminKeys.roles, adminKeys.teams],
  )

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn()
      if (success) toast.success(success)
    } catch (err) {
      reportError(err, t)
      throw err
    }
  }

  if (query.isPending) {
    return (
      <div className="grid max-w-3xl gap-4" aria-busy="true">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title={t('users.title')} back={{ to: '/users', label: t('users.title') }} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  }

  const user = query.data
  const name = fullName(user)
  const isSuper = user.role?.systemKey === SYSTEM_ROLES.SUPER_ADMIN
  const anyAction = user.can.changeStatus || user.can.resetPassword || user.can.archive

  const menuItem = (icon: ReactNode, label: string, onSelect: () => void, destructive = false) => (
    <DropdownMenuItem variant={destructive ? 'destructive' : 'default'} onSelect={onSelect}>
      {icon} {label}
    </DropdownMenuItem>
  )

  return (
    <>
      <PageHeader
        back={{ to: '/users', label: t('users.title') }}
        title={name}
        meta={
          <>
            <StatusBadge kind="userStatus" value={user.status} />
            {user.role && <Badge tone="outline">{user.role.name}</Badge>}
            {user.locked && <Badge tone="danger">{t('users.locked')}</Badge>}
            {user.mustChangePassword && <Badge tone="warning">{t('users.mustChange')}</Badge>}
          </>
        }
        actions={
          <>
            {user.can.changeAccess && (
              <Button variant="secondary" onClick={() => setSheet('access')}>
                <ShieldCheck aria-hidden /> {t('users.changeAccess')}
              </Button>
            )}
            {anyAction && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" aria-label={t('actions.openMenu')}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {user.can.changeStatus &&
                    user.locked &&
                    menuItem(
                      <Unlock />,
                      t('users.unlock'),
                      () =>
                        void run(() => setStatus.mutateAsync('ACTIVE'), t('users.statusChanged')),
                    )}
                  {user.can.resetPassword &&
                    menuItem(<KeyRound />, t('users.resetPassword'), () => setConfirm('reset'))}
                  {user.can.changeStatus &&
                    (user.status === 'DISABLED'
                      ? menuItem(
                          <UserCheck />,
                          t('users.enable'),
                          () =>
                            void run(
                              () => setStatus.mutateAsync('ACTIVE'),
                              t('users.statusChanged'),
                            ),
                        )
                      : menuItem(<UserX />, t('users.disable'), () => setConfirm('disable')))}
                  {user.can.archive && (
                    <>
                      <DropdownMenuSeparator />
                      {menuItem(<Trash2 />, t('users.archive'), () => setConfirm('archive'), true)}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <div className="grid max-w-3xl gap-4">
        {user.locked && <Callout tone="danger">{t('users.lockedNotice')}</Callout>}
        {user.mustChangePassword && !user.locked && (
          <Callout tone="warning">{t('users.mustChangeNotice')}</Callout>
        )}

        <Panel>
          <PanelHeader>
            <PanelTitle>{t('users.sectionProfile')}</PanelTitle>
            {user.can.edit && (
              <Button variant="ghost" size="sm" onClick={() => setSheet('profile')}>
                <Pencil aria-hidden /> {t('actions.edit')}
              </Button>
            )}
          </PanelHeader>
          <PanelBody className="py-1">
            <DetailList
              items={[
                { label: t('users.email'), value: user.email },
                { label: t('users.username'), value: user.username },
                { label: t('users.phone'), value: user.phone },
                { label: t('users.jobTitle'), value: user.jobTitle },
                {
                  label: t('users.hourlyRate'),
                  value:
                    user.hourlyRate &&
                    t('users.perHour', { amount: formatCurrency(user.hourlyRate) }),
                },
                {
                  label: t('users.colLastLogin'),
                  value: user.lastLoginAt ? formatRelative(user.lastLoginAt) : t('common.never'),
                },
                { label: t('users.created_at'), value: formatDate(user.createdAt) },
              ]}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>{t('users.sectionAccess')}</PanelTitle>
          </PanelHeader>
          <PanelBody className="py-1">
            <DetailList
              items={[
                { label: t('users.role'), value: user.role?.name },
                {
                  label: t('users.restaurants'),
                  value: isSuper ? (
                    t('users.allRestaurants')
                  ) : user.restaurants.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {user.restaurants.map((r) => (
                        <li key={r.id}>
                          <Badge tone="outline">{r.name}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null,
                },
                {
                  label: t('users.teams'),
                  value: user.teams.length ? (
                    user.teams.map((tm) => tm.name).join(', ')
                  ) : (
                    <span className="text-muted-foreground">{t('users.noTeams')}</span>
                  ),
                },
              ]}
            />
          </PanelBody>
        </Panel>
      </div>

      <Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {sheet === 'access' ? t('users.changeAccess') : t('users.editProfile')}
            </SheetTitle>
            <SheetDescription>{sheet === 'access' ? t('users.accessHint') : name}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {sheet === 'profile' && <ProfileForm user={user} onDone={() => setSheet(null)} />}
            {sheet === 'access' && <AccessForm user={user} onDone={() => setSheet(null)} />}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirm === 'disable'}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="destructive"
        title={t('users.disableTitle', { name })}
        description={t('users.disableBody')}
        confirmLabel={t('users.disable')}
        onConfirm={() => run(() => setStatus.mutateAsync('DISABLED'), t('users.statusChanged'))}
      />
      <ConfirmDialog
        open={confirm === 'reset'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('users.resetTitle', { name })}
        description={t('users.resetBody')}
        confirmLabel={t('users.resetPassword')}
        onConfirm={() =>
          run(async () => {
            const { temporaryPassword } = await reset.mutateAsync()
            setTempPassword({
              name,
              password: temporaryPassword,
              title: t('users.tempPasswordTitle'),
            })
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="destructive"
        title={t('users.archiveTitle', { name })}
        description={t('users.archiveBody')}
        confirmLabel={t('users.archive')}
        onConfirm={() =>
          run(async () => {
            await archive.mutateAsync()
            navigate('/users', { replace: true })
          }, t('users.archived'))
        }
      />
      <TempPasswordDialog value={tempPassword} onClose={() => setTempPassword(null)} />
    </>
  )
}

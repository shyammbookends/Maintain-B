import {
  SYSTEM_ROLES,
  USER_SORT_FIELDS,
  USER_STATUS,
  createUserSchema,
  fullName,
  type CreateUserInput,
  type UserListItem,
} from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { UserAccessFields } from '@/components/admin/UserAccessFields'
import { Can } from '@/components/common/Can'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import {
  Form,
  FormActions,
  FormRootError,
  PasswordField,
  TextField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  adminKeys,
  useAssignableRoles,
  useInvalidatingMutation,
  useRestaurants,
  useUsers,
} from '@/hooks/useAdminQueries'
import { useTableState } from '@/hooks/useTableState'
import { usersApi } from '@/services/admin.service'
import { describeError } from '@/utils/errors'
import { formatRelative } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { TempPasswordDialog, type TempPassword } from './TempPasswordDialog'
import { ListCard as MListCard, MAvatar } from '@/components/mobile/kit'
import { initialsOf } from '@/components/mobile/tones'

const FILTERS = ['status', 'roleId', 'restaurantId'] as const
const TABLE_CONFIG = {
  sortFields: USER_SORT_FIELDS,
  defaultSort: { field: 'name', direction: 'asc' },
  filters: FILTERS,
} as const

const EMPTY_USER: CreateUserInput = {
  firstName: '',
  lastName: '',
  email: '',
  username: '',
  phone: '',
  jobTitle: '',
  hourlyRate: '',
  roleId: '',
  restaurantIds: [],
  password: '',
}

function signInLabel(u: Pick<UserListItem, 'email' | 'username' | 'phone'>): string {
  return u.email ?? u.username ?? u.phone ?? '—'
}

function CreateUserForm({
  onCreated,
  onCancel,
}: {
  onCreated: (p: TempPassword) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const form = useZodForm(createUserSchema, { defaultValues: EMPTY_USER })
  const create = useInvalidatingMutation(usersApi.create, [adminKeys.users])
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { user, temporaryPassword } = await create.mutateAsync(values)
      onCreated({ name: fullName(user), password: temporaryPassword, title: t('users.created') })
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
            autoComplete="off"
          />
          <TextField
            control={form.control}
            name="lastName"
            label={t('users.lastName')}
            required
            autoComplete="off"
          />
        </div>
        <fieldset className="grid gap-3 rounded-md border p-3">
          <legend className="px-1 text-xs text-muted-foreground">
            {t('users.identifiersHint')}
          </legend>
          <TextField
            control={form.control}
            name="email"
            type="email"
            label={t('users.email')}
            autoComplete="off"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="username"
              label={t('users.username')}
              autoComplete="off"
              autoCapitalize="none"
            />
            <TextField
              control={form.control}
              name="phone"
              type="tel"
              label={t('users.phone')}
              autoComplete="off"
            />
          </div>
        </fieldset>
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

        <UserAccessFields control={form.control} />
        <PasswordField
          control={form.control}
          name="password"
          label={t('users.password')}
          description={t('users.passwordHint')}
          autoComplete="new-password"
        />
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('actions.create')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

const col = createColumnHelper<UserListItem>()

export function UsersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const table = useTableState<(typeof USER_SORT_FIELDS)[number], (typeof FILTERS)[number]>(
    TABLE_CONFIG,
  )
  const query = useUsers(table.apiQuery)
  const roles = useAssignableRoles()
  const restaurants = useRestaurants()
  const [creating, setCreating] = useState(false)
  const [tempPassword, setTempPassword] = useState<TempPassword | null>(null)

  const columns = [
    col.accessor((u) => fullName(u), {
      id: 'name',
      header: t('users.colName'),
      enableSorting: true,
      enableHiding: false,
      cell: ({ row: { original: u } }) => (
        <div className="flex min-w-48 items-center gap-2.5">
          <Avatar name={fullName(u)} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium">{fullName(u)}</p>
            {(u.locked || u.mustChangePassword) && (
              <div className="mt-0.5 flex gap-1">
                {u.locked && <Badge tone="danger">{t('users.locked')}</Badge>}
                {u.mustChangePassword && <Badge tone="warning">{t('users.mustChange')}</Badge>}
              </div>
            )}
          </div>
        </div>
      ),
    }),
    col.accessor((u) => signInLabel(u), {
      id: 'contact',
      header: t('users.colContact'),
      meta: { hideBelow: 'md', label: t('users.colContact') },
      cell: (c) => <span className="text-muted-foreground">{c.getValue()}</span>,
    }),
    col.accessor((u) => u.role?.name ?? '—', { id: 'role', header: t('users.colRole') }),
    col.accessor('restaurants', {
      header: t('users.colRestaurants'),
      meta: { hideBelow: 'lg' },
      cell: ({ row: { original: u } }) => {
        if (u.role?.systemKey === SYSTEM_ROLES.SUPER_ADMIN) {
          return <span className="text-muted-foreground">{t('users.allRestaurants')}</span>
        }
        const shown = u.restaurants
          .slice(0, 2)
          .map((r) => r.name)
          .join(', ')
        const more = u.restaurants.length - 2
        return (
          <span className="whitespace-nowrap text-muted-foreground">
            {shown || '—'}
            {more > 0 && ` ${t('users.more', { count: more })}`}
          </span>
        )
      },
    }),
    col.accessor('status', {
      header: t('users.colStatus'),
      cell: (c) => <StatusBadge kind="userStatus" value={c.getValue()} />,
    }),
    col.accessor('lastLoginAt', {
      id: 'lastLoginAt',
      header: t('users.colLastLogin'),
      enableSorting: true,
      meta: { hideBelow: 'md' },
      cell: (c) => {
        const v = c.getValue()
        return (
          <span className="whitespace-nowrap text-muted-foreground">
            {v ? formatRelative(v) : t('common.never')}
          </span>
        )
      },
    }),
  ]

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={
          <Can permission="users:create">
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> {t('users.new')}
            </Button>
          </Can>
        }
      />

      <DataTable
        label={t('users.title')}
        persistKey="users"
        columns={columns}
        data={query.data?.data}
        getRowId={(u) => u.id}
        total={query.data?.meta.total}
        page={table.state.page}
        pageSize={table.state.pageSize}
        pageSizes={table.pageSizes}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        sort={table.state.sort}
        onSortChange={(s) => table.setSort(s as typeof table.state.sort)}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(u) => navigate(`/users/${u.id}`)}
        renderCard={(u) => (
          <MListCard
            to={`/users/${u.id}`}
            leading={<MAvatar initials={initialsOf(u)} size={40} />}
            title={fullName(u)}
            lines={[
              [u.role?.name, u.jobTitle].filter(Boolean).join(' · '),
              [u.username, u.phone].filter(Boolean).join(' · '),
              u.restaurants.map((r) => r.name).join(', '),
            ]}
            trailing={<StatusBadge kind="userStatus" value={u.status} />}
          />
        )}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder={t('users.search')}
            />
            <FilterSelect
              label={t('users.filterStatus')}
              value={table.state.filters.status}
              onChange={(v) => table.setFilter('status', v)}
              options={USER_STATUS.map((s) => ({ value: s, label: enumLabel(t, 'userStatus', s) }))}
            />
            {(roles.data?.length ?? 0) > 1 && (
              <FilterSelect
                label={t('users.filterRole')}
                value={table.state.filters.roleId}
                onChange={(v) => table.setFilter('roleId', v)}
                options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
            {(restaurants.data?.length ?? 0) > 1 && (
              <FilterSelect
                label={t('users.filterRestaurant')}
                value={table.state.filters.restaurantId}
                onChange={(v) => table.setFilter('restaurantId', v)}
                options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
          </>
        }
        emptyState={
          <EmptyState
            icon={Users}
            title={t('users.emptyTitle')}
            description={t('users.emptyBody')}
            action={
              <Can permission="users:create">
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus aria-hidden /> {t('users.new')}
                </Button>
              </Can>
            }
          />
        }
      />

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('users.createTitle')}</SheetTitle>
            <SheetDescription>{t('users.subtitle')}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {creating && (
              <CreateUserForm
                onCancel={() => setCreating(false)}
                onCreated={(p) => {
                  setCreating(false)
                  setTempPassword(p)
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <TempPasswordDialog value={tempPassword} onClose={() => setTempPassword(null)} />
    </>
  )
}

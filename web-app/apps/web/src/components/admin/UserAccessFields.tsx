import { SYSTEM_ROLES } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import type { Control, FieldValues, Path } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { Callout } from '@/components/common/Callout'
import { CheckboxListField } from '@/components/forms/CheckboxListField'
import { SelectField } from '@/components/forms'
import { useAssignableRoles, useRestaurants } from '@/hooks/useAdminQueries'
import { enumLabel } from '@/utils/i18n'

interface AccessValues extends FieldValues {
  roleId: string
  restaurantIds: string[]
}

/**
 * Role + restaurants, shared by "New user" and "Change access". Only roles the
 * current user may grant and restaurants in their scope are offered (the API
 * enforces the same).
 */
export function UserAccessFields<T extends AccessValues>({ control }: { control: Control<T> }) {
  const { t } = useTranslation()
  const roles = useAssignableRoles()
  const restaurants = useRestaurants()
  const roleId = useWatch({ control, name: 'roleId' as Path<T> }) as string
  const selectedRole = roles.data?.find((r) => r.id === roleId)
  const isSuperAdmin = selectedRole?.systemKey === SYSTEM_ROLES.SUPER_ADMIN

  return (
    <>
      <SelectField
        control={control}
        name={'roleId' as Path<T>}
        label={t('users.role')}
        required
        placeholder={t('validation.selectOption')}
        options={(roles.data ?? []).map((r) => ({
          value: r.id,
          label: `${r.name} · ${enumLabel(t, 'roleKind', r.kind)}`,
        }))}
      />
      {isSuperAdmin ? (
        <Callout tone="info">{t('users.superAdminRestaurants')}</Callout>
      ) : (
        <CheckboxListField
          control={control}
          name={'restaurantIds' as Path<T>}
          label={t('users.restaurants')}
          description={t('users.restaurantsHint')}
          emptyMessage={t('users.noRestaurantsYet')}
          options={(restaurants.data ?? []).map((r) => ({
            value: r.id,
            label: `${r.name} (${r.code})`,
          }))}
        />
      )}
    </>
  )
}

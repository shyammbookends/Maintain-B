import { Building2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCurrentUser } from '@/contexts/AuthContext'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'

const ALL = '__all__'

/** Top-bar restaurant scope. Hidden when the user has only one restaurant. */
export function RestaurantSwitcher() {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const { restaurantId, setRestaurantId } = useRestaurantScope()
  if (user.restaurants.length <= 1) return null

  return (
    <Select
      value={restaurantId ?? ALL}
      onValueChange={(v) => setRestaurantId(v === ALL ? null : v)}
    >
      <SelectTrigger aria-label={t('scope.label')} className="h-9 w-auto max-w-64 min-w-44 gap-2">
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={ALL}>
          {user.isSuperAdmin ? t('scope.allSuper') : t('scope.all')}
        </SelectItem>
        <SelectSeparator />
        {user.restaurants.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

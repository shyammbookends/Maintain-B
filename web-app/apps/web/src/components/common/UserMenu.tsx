import { fullName } from '@maintainx/shared'
import { LogOut, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth, useCurrentUser } from '@/contexts/AuthContext'

/** Top-bar account menu for the admin app. */
export function UserMenu({ accountPath }: { accountPath: string }) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const { logout } = useAuth()
  const name = fullName(user)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('nav.userMenu')}
        className="flex items-center gap-2 rounded-md p-1 pr-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Avatar name={name} size="sm" />
        <span className="hidden max-w-40 truncate font-medium sm:inline">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="grid gap-0.5 font-normal">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          <span className="truncate">{user.email ?? user.username ?? user.phone}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={accountPath}>
            <UserRound /> {t('nav.account')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut /> {t('actions.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { useAuth } from '@/contexts/AuthContext'
import { AdminHome } from '@/layouts/AppShells'
import { DashboardPage } from './DashboardPage'

/** "/" in the admin app: the dashboard, or the first module for users who can't see it. */
export function AdminIndex() {
  return useAuth().can('dashboard:view') ? <DashboardPage /> : <AdminHome />
}

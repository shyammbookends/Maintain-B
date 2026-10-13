import { Home } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { filterNavigation, type NavGroup } from './navigation'

const NAV: NavGroup[] = [
  {
    key: 'ops',
    items: [
      { key: 'dash', label: 'Dashboard', to: '/', icon: Home },
      { key: 'wo', label: 'Work orders', to: '/wo', icon: Home, permission: 'work_orders:view' },
    ],
  },
  {
    key: 'system',
    items: [
      {
        key: 'audit',
        label: 'Audit logs',
        to: '/audit',
        icon: Home,
        permission: 'audit_logs:view',
      },
    ],
  },
]

describe('filterNavigation', () => {
  it('keeps unrestricted items and permitted ones; drops empty groups', () => {
    const out = filterNavigation(NAV, (p) => p === 'work_orders:view')
    expect(out.map((g) => g.key)).toEqual(['ops'])
    expect(out[0]!.items.map((i) => i.key)).toEqual(['dash', 'wo'])
  })

  it('shows everything to a user with all permissions', () => {
    expect(filterNavigation(NAV, () => true).flatMap((g) => g.items)).toHaveLength(3)
  })
})

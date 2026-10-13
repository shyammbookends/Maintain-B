import {
  Blocks,
  MessageSquareWarning,
  Palette,
  PanelsTopLeft,
  Smartphone,
  Table2,
  TextCursorInput,
} from 'lucide-react'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { Badge } from '@/components/ui/badge'
import { AdminLayout } from '@/layouts/AdminLayout'
import { BrandMark } from '@/layouts/BrandMark'
import type { NavGroup } from '@/layouts/navigation'

const NAV: NavGroup[] = [
  {
    key: 'foundations',
    label: 'Foundations',
    items: [{ key: 'tokens', label: 'Colour & type', to: '/design', icon: Palette, end: true }],
  },
  {
    key: 'components',
    label: 'Components',
    items: [
      { key: 'components', label: 'Buttons & inputs', to: '/design/components', icon: Blocks },
      { key: 'forms', label: 'Forms', to: '/design/forms', icon: TextCursorInput },
      { key: 'table', label: 'Data table', to: '/design/data-table', icon: Table2 },
      { key: 'overlays', label: 'Overlays', to: '/design/overlays', icon: PanelsTopLeft },
      {
        key: 'feedback',
        label: 'Feedback & states',
        to: '/design/feedback',
        icon: MessageSquareWarning,
      },
    ],
  },
  {
    key: 'worker',
    label: 'Worker app',
    items: [{ key: 'worker', label: 'Phone preview', to: '/design/worker', icon: Smartphone }],
  },
]

/** Dev-only gallery shell. It is itself the Admin layout, so the shell is reviewed in use. */
export function DesignShell() {
  return (
    <AdminLayout
      nav={NAV}
      brand={<BrandMark subtitle="Design system" />}
      headerStart={
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Component gallery</span>
          <Badge tone="outline">Development only</Badge>
        </div>
      }
      headerEnd={<LanguageSwitcher />}
    />
  )
}

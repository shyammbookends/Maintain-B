import type { ReactNode } from 'react'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { cn } from '@/utils/cn'

/** Gallery helper: titled panel with an optional usage note. */
export function Section({
  title,
  note,
  children,
  bodyClassName,
}: {
  title: string
  note?: ReactNode
  children: ReactNode
  bodyClassName?: string
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
      </PanelHeader>
      <PanelBody className={cn('grid gap-4', bodyClassName)}>
        {note && <p className="text-13 text-muted-foreground">{note}</p>}
        {children}
      </PanelBody>
    </Panel>
  )
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>
}

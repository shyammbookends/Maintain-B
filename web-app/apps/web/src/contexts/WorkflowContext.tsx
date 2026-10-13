import { workflowSettingsSchema, type WorkflowSettings } from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { http } from '@/services/http'

/**
 * The organisation's workflow switches (photos, repair report, verification,
 * simple statuses, extra inventory tools). Loaded once per shell; screens
 * outside a provider (and while loading) show the full, detailed flow.
 */
const Ctx = createContext<WorkflowSettings | null>(null)

export const WORKFLOW_KEY = ['settings', 'workflow'] as const

export function useWorkflowQuery() {
  return useQuery({
    queryKey: WORKFLOW_KEY,
    queryFn: ({ signal }) =>
      http.get<{ data: WorkflowSettings }>('/settings/workflow', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
  })
}

export function WorkflowProvider({ children }: { children: ReactNode }) {
  const query = useWorkflowQuery()
  // Anything unexpected falls back to the full flow rather than hiding things.
  const value = useMemo(() => {
    const parsed = workflowSettingsSchema.safeParse(query.data)
    return parsed.success ? parsed.data : null
  }, [query.data])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The workflow settings, or null outside a shell / before they load. */
export function useWorkflow(): WorkflowSettings | null {
  return useContext(Ctx)
}

/**
 * GALLERY ONLY. Deterministic sample data and an in-memory "server" used to
 * exercise the design-system components at /design. Never imported by
 * product code; real data comes from the API from Phase 7 onwards.
 */
import {
  PRIORITY,
  WORK_ORDER_CATEGORY,
  WORK_ORDER_STATUS,
  buildPageMeta,
  type PagedResponse,
  type Priority,
  type WorkOrderCategory,
  type WorkOrderStatus,
} from '@maintainx/shared'
import { ApiError } from '@/services/http'

export interface DemoWorkOrder {
  id: string
  code: string
  title: string
  restaurant: string
  location: string
  asset: string
  category: WorkOrderCategory
  priority: Priority
  status: WorkOrderStatus
  assignee: string | null
  dueDate: string
  estimatedMinutes: number
}

// Small seeded PRNG so the sample set is identical on every load.
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ISSUES: Array<{
  title: string
  asset: string
  location: string
  category: WorkOrderCategory
}> = [
  {
    title: 'Walk-in freezer not holding temperature',
    asset: 'Walk-in freezer',
    location: 'Storage',
    category: 'REFRIGERATION',
  },
  {
    title: 'Dishwasher drain blocked',
    asset: 'Dishwasher',
    location: 'Dishwashing',
    category: 'KITCHEN_EQUIPMENT',
  },
  {
    title: 'Exhaust hood fan making noise',
    asset: 'Exhaust hood',
    location: 'Hot kitchen',
    category: 'KITCHEN_EQUIPMENT',
  },
  { title: 'AC unit leaking water', asset: 'Split AC 2', location: 'Dining', category: 'AC' },
  {
    title: 'Ice machine low output',
    asset: 'Ice machine',
    location: 'Bar',
    category: 'REFRIGERATION',
  },
  {
    title: 'POS terminal not booting',
    asset: 'POS terminal 1',
    location: 'Dining',
    category: 'IT_POS',
  },
  {
    title: 'Fire extinguisher refill due',
    asset: 'CO2 extinguisher',
    location: 'Kitchen',
    category: 'FIRE_SAFETY',
  },
  {
    title: 'Burner flame uneven',
    asset: '4-burner range',
    location: 'Hot kitchen',
    category: 'GAS',
  },
  {
    title: 'RO filter replacement',
    asset: 'RO purifier',
    location: 'Preparation',
    category: 'PLUMBING',
  },
  {
    title: 'Cold room door seal torn',
    asset: 'Cold room',
    location: 'Cold kitchen',
    category: 'REFRIGERATION',
  },
  {
    title: 'Tripping breaker on line 3',
    asset: 'Main panel',
    location: 'Utility',
    category: 'ELECTRICAL',
  },
  {
    title: 'Monthly pest control visit',
    asset: '—',
    location: 'Kitchen',
    category: 'PEST_CONTROL',
  },
  {
    title: 'Coffee machine pressure low',
    asset: 'Espresso machine',
    location: 'Bar',
    category: 'KITCHEN_EQUIPMENT',
  },
  { title: 'Sink tap leaking', asset: 'Prep sink', location: 'Preparation', category: 'PLUMBING' },
  { title: 'CCTV camera offline', asset: 'Camera 4', location: 'Office', category: 'IT_POS' },
]

const RESTAURANTS = Array.from({ length: 7 }, (_, i) => `Restaurant ${i + 1}`)
const ASSIGNEES = ['Ramesh K.', 'Suresh P.', 'Imran S.', 'Priya M.', 'Deepak R.', null]

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]!
}

function generate(count: number): DemoWorkOrder[] {
  const rand = mulberry32(20261002)
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => {
    const issue = pick(rand, ISSUES)
    const status = pick(rand, WORK_ORDER_STATUS)
    const assignee = status === 'OPEN' ? null : pick(rand, ASSIGNEES.filter(Boolean))
    // Due dates spread from 3 days ago to 12 days ahead, on the quarter hour.
    const offsetHours = Math.floor(rand() * 15 * 24) - 3 * 24
    const due = new Date(now + offsetHours * 3_600_000)
    due.setMinutes(Math.floor(due.getMinutes() / 15) * 15, 0, 0)
    return {
      id: `demo-${i + 1}`,
      code: `WO-${String(1000 + i).padStart(6, '0')}`,
      title: issue.title,
      restaurant: pick(rand, RESTAURANTS),
      location: issue.location,
      asset: issue.asset,
      category: issue.category,
      priority: pick(rand, PRIORITY),
      status,
      assignee,
      dueDate: due.toISOString(),
      estimatedMinutes: (1 + Math.floor(rand() * 8)) * 15,
    }
  })
}

export const DEMO_WORK_ORDERS: readonly DemoWorkOrder[] = generate(237)
export const DEMO_RESTAURANTS = RESTAURANTS
export const DEMO_CATEGORIES = WORK_ORDER_CATEGORY

export interface DemoQuery {
  page: number
  pageSize: number
  sort?: string
  q?: string
  status?: string
  priority?: string
  restaurant?: string
}

const PRIORITY_RANK: Record<Priority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

/** Behaves like a real list endpoint: filter → sort → paginate, with network latency. */
export async function fetchDemoWorkOrders(
  query: DemoQuery,
  options: { signal?: AbortSignal; empty?: boolean; fail?: boolean } = {},
): Promise<PagedResponse<DemoWorkOrder>> {
  await sleep(350 + Math.random() * 300, options.signal)
  if (options.fail) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Demo failure', undefined, 'demo-7f3a9c21')
  }

  let rows = options.empty ? [] : [...DEMO_WORK_ORDERS]
  const q = query.q?.trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.asset.toLowerCase().includes(q),
    )
  }
  if (query.status) rows = rows.filter((r) => r.status === query.status)
  if (query.priority) rows = rows.filter((r) => r.priority === query.priority)
  if (query.restaurant) rows = rows.filter((r) => r.restaurant === query.restaurant)

  if (query.sort) {
    const [field, dir] = query.sort.split(':') as [keyof DemoWorkOrder, 'asc' | 'desc']
    const sign = dir === 'desc' ? -1 : 1
    rows.sort((a, b) => {
      const av = field === 'priority' ? PRIORITY_RANK[a.priority] : String(a[field] ?? '')
      const bv = field === 'priority' ? PRIORITY_RANK[b.priority] : String(b[field] ?? '')
      return av < bv ? -sign : av > bv ? sign : 0
    })
  }

  const start = (query.page - 1) * query.pageSize
  return {
    data: rows.slice(start, start + query.pageSize),
    meta: buildPageMeta(query.page, query.pageSize, rows.length),
  }
}

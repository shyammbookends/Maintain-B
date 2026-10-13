/** GALLERY ONLY: sample tasks for the worker phone preview. */
import type { Priority, WorkOrderStatus } from '@maintainx/shared'

export interface PreviewTask {
  id: string
  code: string
  title: string
  restaurant: string
  location: string
  asset: string
  priority: Priority
  status: WorkOrderStatus
  dueInHours: number
  description: string
  steps: string[]
}

export const PREVIEW_TASKS: PreviewTask[] = [
  {
    id: '1',
    code: 'WO-001042',
    title: 'Walk-in freezer not holding temperature',
    restaurant: 'Restaurant 2',
    location: 'Storage',
    asset: 'Walk-in freezer',
    priority: 'CRITICAL',
    status: 'ASSIGNED',
    dueInHours: -2,
    description:
      'Display reads −8 °C, should be −18 °C. Staff noticed ice build-up on the evaporator.',
    steps: [
      'Temperature reading',
      'Door seal',
      'Compressor',
      'Evaporator fan',
      'Condenser coil',
      'Power connection',
    ],
  },
  {
    id: '2',
    code: 'WO-001051',
    title: 'Dishwasher drain blocked',
    restaurant: 'Restaurant 2',
    location: 'Dishwashing',
    asset: 'Dishwasher',
    priority: 'HIGH',
    status: 'IN_PROGRESS',
    dueInHours: 3,
    description: 'Water not draining after cycle.',
    steps: ['Drain filter', 'Drain pump', 'Hose', 'Test cycle'],
  },
  {
    id: '3',
    code: 'WO-001058',
    title: 'Weekly cleaning — ice machine',
    restaurant: 'Restaurant 5',
    location: 'Bar',
    asset: 'Ice machine',
    priority: 'MEDIUM',
    status: 'ASSIGNED',
    dueInHours: 26,
    description: 'Preventive maintenance: weekly sanitising cycle.',
    steps: ['Empty bin', 'Run cleaning cycle', 'Sanitise bin', 'Inspect water filter'],
  },
]

export function dueFromNow(hours: number, now = new Date()): Date {
  return new Date(now.getTime() + hours * 3_600_000)
}

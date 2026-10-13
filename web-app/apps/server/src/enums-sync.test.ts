import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as shared from '@maintainx/shared'
import { describe, expect, it } from 'vitest'

const schema = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
)

function prismaEnumValues(name: string): string[] {
  const match = schema.match(new RegExp(`^enum ${name} \\{([^}]*)\\}`, 'm'))
  if (!match?.[1]) throw new Error(`enum ${name} not found in schema.prisma`)
  return match[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
}

// Prisma enum name → shared constant. Adding an enum to either side without
// updating this table fails the "every enum is covered" test below.
const PAIRS: ReadonlyArray<[string, readonly string[]]> = [
  ['UserStatus', shared.USER_STATUS],
  ['RoleKind', shared.ROLE_KIND],
  ['PermissionAction', shared.ACTIONS.map((a) => a.toUpperCase())],
  ['RestaurantStatus', shared.RESTAURANT_STATUS],
  ['LocationType', shared.LOCATION_TYPE],
  ['AssetStatus', shared.ASSET_STATUS],
  ['AssetEventType', shared.ASSET_EVENT_TYPE],
  ['AssetCriticality', shared.ASSET_CRITICALITY],
  ['Priority', shared.PRIORITY],
  ['EvidenceStage', shared.EVIDENCE_STAGE],
  ['RepeatUnit', shared.REPEAT_UNIT],
  ['RepeatBasis', shared.REPEAT_BASIS],
  ['CustomFieldEntity', shared.CUSTOM_FIELD_ENTITY],
  ['CustomFieldType', shared.CUSTOM_FIELD_TYPE],
  ['ConversationType', shared.CONVERSATION_TYPE],
  ['FinalCondition', shared.FINAL_CONDITION],
  ['PartCondition', shared.PART_CONDITION],
  ['WorkOrderStatus', shared.WORK_ORDER_STATUS],
  ['WorkOrderCostType', shared.WORK_ORDER_COST_TYPE],
  ['WorkOrderType', shared.WORK_ORDER_TYPE],
  ['WorkOrderCategory', shared.WORK_ORDER_CATEGORY],
  ['RequestStatus', shared.REQUEST_STATUS],
  ['StepInputType', shared.STEP_INPUT_TYPE],
  ['StepResult', shared.STEP_RESULT],
  ['AttachmentOwnerType', shared.ATTACHMENT_OWNER_TYPE],
  ['AttachmentKind', shared.ATTACHMENT_KIND],
  ['Frequency', shared.FREQUENCY],
  ['PmTriggerType', shared.PM_TRIGGER_TYPE],
  ['ReportFrequency', shared.REPORT_FREQUENCY],
  ['ReportFormat', shared.REPORT_FORMAT],
  ['InspectionType', shared.INSPECTION_TYPE],
  ['InspectionStatus', shared.INSPECTION_STATUS],
  ['InventoryTxnType', shared.INVENTORY_TXN_TYPE],
  ['ReservationStatus', shared.RESERVATION_STATUS],
  ['StockCountStatus', shared.STOCK_COUNT_STATUS],
  ['MeterType', shared.METER_TYPE],
  ['AutomationTrigger', shared.AUTOMATION_TRIGGER],
  ['AutomationRunStatus', shared.AUTOMATION_RUN_STATUS],
  ['FailureCategory', shared.FAILURE_CATEGORY],
  ['PurchaseOrderStatus', shared.PURCHASE_ORDER_STATUS],
  ['VendorCategory', shared.VENDOR_CATEGORY],
  ['DocumentOwnerType', shared.DOCUMENT_OWNER_TYPE],
  ['DocumentType', shared.DOCUMENT_TYPE],
  ['NotificationType', shared.NOTIFICATION_TYPE],
  ['SettingScope', shared.SETTING_SCOPE],
  ['AuditEntityType', shared.AUDIT_ENTITY_TYPE],
]

describe('Prisma enums mirror @maintainx/shared', () => {
  it.each(PAIRS)('%s', (name, values) => {
    expect(prismaEnumValues(name)).toEqual([...values])
  })

  it('every Prisma enum is covered by the sync table', () => {
    const inSchema = [...schema.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]).sort()
    expect(inSchema).toEqual(PAIRS.map(([n]) => n).sort())
  })
})

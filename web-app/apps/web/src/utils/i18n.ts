import type { TFunction } from 'i18next'

/**
 * Translation keys are type-checked at call sites (see i18n/i18next.d.ts).
 * These helpers cover the few places where keys are built at runtime
 * (enum labels, validation messages coming from schemas or the API).
 */
type LooseT = (key: string, options?: Record<string, unknown>) => string

export function looseT(t: TFunction): LooseT {
  return t as unknown as LooseT
}

export type EnumKind =
  | 'workOrderStatus'
  | 'workOrderCategory'
  | 'assetStatus'
  | 'priority'
  | 'purchaseOrderStatus'
  | 'requestStatus'
  | 'stepResult'
  | 'userStatus'
  | 'roleKind'
  | 'restaurantStatus'
  | 'locationType'
  | 'assetEventType'
  | 'warranty'
  | 'frequency'
  | 'inspectionType'
  | 'inspectionStatus'
  | 'stepInputType'
  | 'vendorCategory'
  | 'inventoryTxnType'
  | 'documentType'
  | 'workOrderType'
  | 'assetCriticality'
  | 'workOrderCostType'
  | 'attachmentKind'
  | 'finalCondition'
  | 'failureCategory'
  | 'meterType'
  | 'automationTrigger'
  | 'partCondition'
  | 'evidenceStage'
  | 'simpleStatus'
  | 'repeatUnit'
  | 'repeatUnitPlural'
  | 'repeatBasis'
  | 'customFieldType'

export function enumLabel(t: TFunction, kind: EnumKind, value: string): string {
  return looseT(t)(`enums.${kind}.${value}`, { defaultValue: value })
}

/** Messages that are i18n keys (`validation.*`) get translated; anything else is shown as-is. */
export function translateValidationMessage(
  t: TFunction,
  message: string | undefined,
): string | undefined {
  if (!message) return message
  return message.startsWith('validation.') ? looseT(t)(message, { defaultValue: message }) : message
}

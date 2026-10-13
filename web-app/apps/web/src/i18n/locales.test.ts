import {
  ASSET_STATUS,
  ERROR_CODES,
  PRIORITY,
  PURCHASE_ORDER_STATUS,
  REQUEST_STATUS,
  STEP_RESULT,
  WORK_ORDER_CATEGORY,
  WORK_ORDER_STATUS,
} from '@maintainx/shared'
import { describe, expect, it } from 'vitest'
import en from './locales/en/common.json'
import gu from './locales/gu/common.json'
import hi from './locales/hi/common.json'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()

const EN = flatten(en as Tree)
const LOCALES: Record<string, Record<string, string>> = {
  hi: flatten(hi as Tree),
  gu: flatten(gu as Tree),
}

describe('translations', () => {
  it.each(Object.keys(LOCALES))('%s has exactly the same keys as en', (lng) => {
    const keys = Object.keys(LOCALES[lng]!).sort()
    expect(keys).toEqual(Object.keys(EN).sort())
  })

  it.each(Object.keys(LOCALES))('%s keeps every {{placeholder}} from en', (lng) => {
    const mismatches = Object.entries(EN)
      .filter(
        ([key, value]) =>
          placeholders(value).join() !== placeholders(LOCALES[lng]![key] ?? '').join(),
      )
      .map(([key]) => key)
    expect(mismatches).toEqual([])
  })

  it('has no empty strings', () => {
    for (const table of [EN, ...Object.values(LOCALES)]) {
      expect(Object.entries(table).filter(([, v]) => v.trim() === '')).toEqual([])
    }
  })

  it('translates every API error code', () => {
    for (const code of [...Object.values(ERROR_CODES), 'NETWORK_ERROR']) {
      expect(EN[`errors.${code}`], code).toBeTruthy()
    }
  })

  it('labels every enum value shown in the UI', () => {
    const enums: Record<string, readonly string[]> = {
      workOrderStatus: WORK_ORDER_STATUS,
      workOrderCategory: WORK_ORDER_CATEGORY,
      assetStatus: ASSET_STATUS,
      priority: PRIORITY,
      purchaseOrderStatus: PURCHASE_ORDER_STATUS,
      requestStatus: REQUEST_STATUS,
      stepResult: STEP_RESULT,
    }
    const missing = Object.entries(enums).flatMap(([kind, values]) =>
      values.filter((v) => !EN[`enums.${kind}.${v}`]).map((v) => `${kind}.${v}`),
    )
    expect(missing).toEqual([])
  })
})

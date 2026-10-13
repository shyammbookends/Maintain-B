import { describe, expect, it } from 'vitest'
import { csvCell, documentExpiry, notificationLinkFor, toCsv } from './platform.js'

describe('csv', () => {
  it('quotes and neutralises formulas', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('-5')).toBe("'-5")
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell('a,"b"')).toBe('"a,""b"""')
    expect(csvCell(null)).toBe('')
    expect(toCsv(['A', 'B'], [[1, 'x']])).toBe('﻿A,B\r\n1,x\r\n')
  })
})

describe('notification links', () => {
  it('maps admin links for workers', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(notificationLinkFor(`/work-orders/${id}`, true)).toBe(`/w/tasks/${id}`)
    expect(notificationLinkFor('/requests?open=x', true)).toBe('/w/reports')
    expect(notificationLinkFor('/purchase-orders/x', true)).toBeNull()
    expect(notificationLinkFor('/purchase-orders/x', false)).toBe('/purchase-orders/x')
  })

  it('maps worker-app links for admins (who can be assignees too)', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(notificationLinkFor(`/w/tasks/${id}`, false)).toBe(`/work-orders/${id}`)
    expect(notificationLinkFor('/w/reports', false)).toBe('/requests')
    expect(notificationLinkFor(`/w/tasks/${id}`, true)).toBe(`/w/tasks/${id}`)
  })
})

describe('document expiry', () => {
  it('classifies dates', () => {
    const today = new Date('2026-10-02T06:00:00Z')
    expect(documentExpiry(null, today)).toBe('none')
    expect(documentExpiry('2026-10-01', today)).toBe('expired')
    expect(documentExpiry('2026-10-20', today)).toBe('expiring')
    expect(documentExpiry('2027-01-01', today)).toBe('valid')
  })
})

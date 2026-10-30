import { describe, expect, test } from 'bun:test'
import {
  MAX_EXPORT_PIXELS,
  MAX_EXPORT_SIDE,
  checkPngBudget,
  filesSignature,
  originMoved,
  pickAppStatePatch,
  sceneBounds,
} from '../src/client/geometry.js'

const rectangle = (overrides = {}) => ({
  id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, ...overrides,
})

describe('canvas geometry and layout inputs', () => {
  test('computes scene bounds including line points', () => {
    expect(sceneBounds([rectangle(), rectangle({ id: 'l', type: 'line', x: 100, y: 0, width: 0, height: 0, points: [[0, 0], [50, 25]] })]))
      .toEqual({ x: 0, y: 0, width: 150, height: 50, count: 2 })
  })

  test('rejects empty, oversized side, and oversized pixel PNG allocations', () => {
    expect(checkPngBudget({ elements: [] }, 2)).toMatchObject({ ok: false, reason: 'empty' })
    const huge = { elements: [rectangle({ width: 9000, height: 10 })] }
    expect(checkPngBudget(huge, 2)).toMatchObject({ ok: false })
    expect(checkPngBudget(huge, 2).width).toBeGreaterThan(MAX_EXPORT_SIDE)
    const pixels = { elements: [rectangle({ width: 5000, height: 5000 })] }
    const result = checkPngBudget(pixels, 1)
    expect(result.ok).toBe(false)
    expect(result.pixels).toBeGreaterThan(MAX_EXPORT_PIXELS)
  })

  test('accounts for export padding around the scene', () => {
    const result = checkPngBudget({ elements: [rectangle()] }, 2, 16)
    expect(result.ok).toBe(true)
    expect(result.width).toBe(Math.ceil((100 + 32) * 2))
    expect(result.height).toBe(Math.ceil((50 + 32) * 2))
  })

  test('detects subpixel origin drift and ignores exactly equal rects', () => {
    expect(originMoved({ left: 10, top: 20 }, { left: 10.005, top: 20 })).toBe(false)
    expect(originMoved({ left: 10, top: 20 }, { left: 10.02, top: 20 })).toBe(true)
    expect(originMoved({ left: 10, top: 20 }, { left: 10, top: 21 })).toBe(true)
  })

  test('appState patch excludes viewport, selection, and unchanged fields', () => {
    const previous = { viewBackgroundColor: '#fff', currentItemFontFamily: 5 }
    const patch = pickAppStatePatch({
      viewBackgroundColor: '#eee',
      currentItemFontFamily: 5,
      scrollX: 999,
      scrollY: 999,
      zoom: { value: 2 },
      selectedElementIds: { a: true },
    }, previous)
    expect(patch).toEqual({ viewBackgroundColor: '#eee' })
  })

  test('file signature changes when image content changes', () => {
    const left = filesSignature({ f1: { dataURL: 'data:image/png;base64,AAAA', mimeType: 'image/png' } })
    const right = filesSignature({ f1: { dataURL: 'data:image/png;base64,BBBB', mimeType: 'image/png' } })
    expect(left).not.toBe(right)
  })
})

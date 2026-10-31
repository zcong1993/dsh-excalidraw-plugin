/** Pure browser geometry and export-budget helpers. */

export const MAX_EXPORT_PIXELS = 16_777_216
export const MAX_EXPORT_SIDE = 16_384

// Official Excalidraw zoom bounds and one footer step; the header controls use
// the same values so a zoom level means the same thing everywhere.
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 30
export const ZOOM_STEP = 0.1

export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** One zoom-button step, rounded to keep 0.1 arithmetic free of float drift. */
export function stepZoom(zoom, direction) {
  const current = clampZoom(zoom)
  const delta = direction < 0 ? -ZOOM_STEP : ZOOM_STEP
  return clampZoom(Math.round((current + delta) * 100) / 100)
}

/**
 * Viewport patch that zooms around the viewport center, mirroring Excalidraw's
 * own getStateForZoom so the point the user is looking at stays put.
 */
export function zoomViewportFor(appState, nextZoom) {
  const zoom = clampZoom(nextZoom)
  const current = clampZoom(appState?.zoom?.value)
  const width = Number.isFinite(appState?.width) ? appState.width : 0
  const height = Number.isFinite(appState?.height) ? appState.height : 0
  const scrollX = Number.isFinite(appState?.scrollX) ? appState.scrollX : 0
  const scrollY = Number.isFinite(appState?.scrollY) ? appState.scrollY : 0
  const centerX = width / 2
  const centerY = height / 2
  return {
    scrollX: scrollX + centerX / zoom - centerX / current,
    scrollY: scrollY + centerY / zoom - centerY / current,
    zoom: { value: zoom },
  }
}

export function zoomPercent(zoom) {
  return Math.round(clampZoom(zoom) * 100)
}

export function elementBounds(element) {
  let x0 = element.x
  let y0 = element.y
  let x1 = element.x + element.width
  let y1 = element.y + element.height
  if (Array.isArray(element.points)) {
    for (const [px, py] of element.points) {
      x0 = Math.min(x0, element.x + px)
      y0 = Math.min(y0, element.y + py)
      x1 = Math.max(x1, element.x + px)
      y1 = Math.max(y1, element.y + py)
    }
  }
  return { x0, y0, x1, y1 }
}

export function sceneBounds(elements) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let count = 0
  for (const element of elements ?? []) {
    if (element.isDeleted === true) continue
    const { x0, y0, x1, y1 } = elementBounds(element)
    minX = Math.min(minX, x0)
    minY = Math.min(minY, y0)
    maxX = Math.max(maxX, x1)
    maxY = Math.max(maxY, y1)
    count += 1
  }
  if (count === 0) return { x: 0, y: 0, width: 0, height: 0, count: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, count }
}

/**
 * Check the PNG allocation budget before asking the official renderer to
 * allocate a bitmap.
 * @returns {{ok: true, width: number, height: number, pixels: number} | {ok: false, reason: string, width: number, height: number, pixels: number}}
 */
export function checkPngBudget(document, scale, padding = 16) {
  const bounds = sceneBounds(document?.elements ?? [])
  if (bounds.count === 0) return { ok: false, reason: 'empty', width: 0, height: 0, pixels: 0 }
  const width = Math.ceil((bounds.width + padding * 2) * scale)
  const height = Math.ceil((bounds.height + padding * 2) * scale)
  const pixels = width * height
  if (width <= 0 || height <= 0) return { ok: false, reason: 'empty', width, height, pixels }
  if (width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE) {
    return { ok: false, reason: `each side must be at most ${MAX_EXPORT_SIDE}px`, width, height, pixels }
  }
  if (pixels > MAX_EXPORT_PIXELS) {
    return { ok: false, reason: `the bitmap would allocate ${pixels} pixels; the limit is ${MAX_EXPORT_PIXELS}`, width, height, pixels }
  }
  return { ok: true, width, height, pixels }
}

/** Whether a layout shift moved the plugin wrapper enough to require refresh. */
export function originMoved(previous, next, epsilon = 0.01) {
  if (previous === undefined || next === undefined) return false
  return Math.abs(previous.left - next.left) > epsilon || Math.abs(previous.top - next.top) > epsilon
}

const APP_STATE_FIELDS = [
  'viewBackgroundColor',
  'gridSize',
  'gridStep',
  'gridModeEnabled',
  'objectsSnapModeEnabled',
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemFillStyle',
  'currentItemStrokeWidth',
  'currentItemStrokeStyle',
  'currentItemRoughness',
  'currentItemOpacity',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemTextAlign',
  'currentItemStartArrowhead',
  'currentItemEndArrowhead',
]

/**
 * Pick durable Excalidraw appState fields. Viewport, selection, and editing
 * state deliberately never enter the source file.
 */
export function pickAppStatePatch(appState, previous = {}) {
  const patch = {}
  for (const field of APP_STATE_FIELDS) {
    if (appState?.[field] === undefined) continue
    if (JSON.stringify(previous?.[field]) === JSON.stringify(appState[field])) continue
    patch[field] = appState[field]
  }
  return patch
}

export function filesSignature(files) {
  const entries = Object.entries(files ?? {})
    .map(([key, value]) => {
      const dataURL = typeof value?.dataURL === 'string' ? value.dataURL : ''
      return [key, dataURL.length, value?.mimeType ?? '', dataURL.slice(0, 96), dataURL.slice(-48)]
    })
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify(entries)
}

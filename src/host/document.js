/**
 * Pure Excalidraw document contract: validation, bounded summaries, versioned
 * patching, editor-state merging, and bounded user-change diffs.
 *
 * No Host service is touched here so the whole contract is unit-testable.
 * @module document
 */

export const LIMITS = Object.freeze({
  maxDocumentBytes: 32 * 1024 * 1024,
  maxElements: 50_000,
  maxPatchElements: 200,
  maxIds: 200,
  defaultPage: 50,
  maxPage: 200,
  maxDiffItems: 100,
  maxDiffBytes: 32 * 1024,
  maxSummaryText: 240,
})

const ELEMENT_TYPES = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'freedraw',
  'text',
  'image',
  'frame',
  'magicframe',
  'embed',
  'iframe',
])

const DIFF_FIELDS = [
  'x', 'y', 'width', 'height', 'angle',
  'strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth', 'strokeStyle',
  'roughness', 'opacity', 'roundness', 'seed',
  'fontSize', 'fontFamily', 'fontStyle', 'text', 'textAlign', 'verticalAlign',
  'containerId', 'groupIds', 'boundElements', 'link', 'locked', 'isDeleted',
  'fileId', 'scale', 'status',
]

const BINDING_FIELDS = new Set(['startBinding', 'endBinding'])

export class ExcalidrawError extends Error {
  /**
   * @param {string} code stable machine code
   * @param {string} message model-facing explanation
   * @param {Record<string, unknown>} [details] structured details such as `currentVersion`
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ExcalidrawError'
    this.code = code
    this.details = details
  }
}

export function fail(code, message, details) {
  return new ExcalidrawError(code, message, details)
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}

function assertFiniteNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
    throw fail('INVALID_DOCUMENT', `${path} must be a finite JSON number`)
  }
}

function assertLosslessJson(value, path = '$', seen = new Set()) {
  if (value === null) return
  const type = typeof value
  if (type === 'string' || type === 'boolean') return
  if (type === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw fail('INVALID_JSON', `${path} is not representable as lossless JSON`)
    }
    return
  }
  if (type !== 'object') throw fail('INVALID_JSON', `${path} contains a non-JSON value`)
  if (seen.has(value)) throw fail('INVALID_JSON', `${path} is circular`)
  seen.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw fail('INVALID_JSON', `${path}[${index}] is a sparse array slot`)
      assertLosslessJson(value[index], `${path}[${index}]`, seen)
    }
  } else {
    if (!isPlainObject(value)) throw fail('INVALID_JSON', `${path} must be a plain JSON object`)
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw fail('INVALID_JSON', `${path} contains the unsafe key "${key}"`)
      }
      assertLosslessJson(value[key], `${path}.${key}`, seen)
    }
  }
  seen.delete(value)
}

function assertElementGeometry(element, path) {
  assertFiniteNumber(element.x, `${path}.x`)
  assertFiniteNumber(element.y, `${path}.y`)
  assertFiniteNumber(element.width, `${path}.width`)
  assertFiniteNumber(element.height, `${path}.height`)
  if (element.width < 0 || element.height < 0) {
    throw fail('INVALID_DOCUMENT', `${path} width and height must be non-negative`)
  }
  if (element.angle !== undefined) assertFiniteNumber(element.angle, `${path}.angle`)
}

function assertPoints(element, path) {
  if (!Array.isArray(element.points) || element.points.length < 2) {
    throw fail('INVALID_DOCUMENT', `${path}.points must contain at least two [x, y] pairs`)
  }
  for (let index = 0; index < element.points.length; index += 1) {
    const point = element.points[index]
    if (!Array.isArray(point) || point.length !== 2) {
      throw fail('INVALID_DOCUMENT', `${path}.points[${index}] must be an [x, y] pair`)
    }
    assertFiniteNumber(point[0], `${path}.points[${index}][0]`)
    assertFiniteNumber(point[1], `${path}.points[${index}][1]`)
  }
}

function assertBinding(value, path, ids) {
  if (value === null || value === undefined) return
  if (!isPlainObject(value)) throw fail('INVALID_DOCUMENT', `${path} must be an object or null`)
  if (typeof value.elementId !== 'string' || value.elementId.length === 0) {
    throw fail('INVALID_DOCUMENT', `${path}.elementId must be a non-empty string`)
  }
  if (!ids.has(value.elementId)) {
    throw fail('INVALID_DOCUMENT', `${path}.elementId "${value.elementId}" does not name an element`)
  }
  for (const key of ['focus', 'gap']) {
    if (value[key] !== undefined) assertFiniteNumber(value[key], `${path}.${key}`)
  }
}

function assertElement(element, path, ids, files) {
  if (!isPlainObject(element)) throw fail('INVALID_DOCUMENT', `${path} must be an object`)
  if (typeof element.id !== 'string' || element.id.trim().length === 0) {
    throw fail('INVALID_DOCUMENT', `${path}.id must be a non-empty string`)
  }
  if (element.id.length > 512) throw fail('INVALID_DOCUMENT', `${path}.id is longer than 512 characters`)
  if (typeof element.type !== 'string' || element.type.length === 0) {
    throw fail('INVALID_DOCUMENT', `${path}.type must be a non-empty string`)
  }
  if (!ELEMENT_TYPES.has(element.type)) {
    throw fail('INVALID_DOCUMENT', `${path}.type "${element.type}" is not a supported Excalidraw element type`)
  }
  assertElementGeometry(element, path)
  if (element.isDeleted !== undefined && typeof element.isDeleted !== 'boolean') {
    throw fail('INVALID_DOCUMENT', `${path}.isDeleted must be a boolean`)
  }
  if (element.groupIds !== undefined) {
    if (!Array.isArray(element.groupIds) || element.groupIds.some((id) => typeof id !== 'string')) {
      throw fail('INVALID_DOCUMENT', `${path}.groupIds must be an array of strings`)
    }
  }
  if (element.containerId !== undefined && element.containerId !== null && typeof element.containerId !== 'string') {
    throw fail('INVALID_DOCUMENT', `${path}.containerId must be a string or null`)
  }
  if (element.boundElements !== undefined) {
    if (!Array.isArray(element.boundElements)) {
      throw fail('INVALID_DOCUMENT', `${path}.boundElements must be an array`)
    }
    for (const [index, binding] of element.boundElements.entries()) {
      if (!isPlainObject(binding) || typeof binding.id !== 'string' || typeof binding.type !== 'string') {
        throw fail('INVALID_DOCUMENT', `${path}.boundElements[${index}] must be { id, type }`)
      }
      if (!ids.has(binding.id)) {
        throw fail('INVALID_DOCUMENT', `${path}.boundElements[${index}] references unknown id "${binding.id}"`)
      }
    }
  }
  for (const field of BINDING_FIELDS) assertBinding(element[field], `${path}.${field}`, ids)
  if (element.type === 'text') {
    if (typeof element.text !== 'string') throw fail('INVALID_DOCUMENT', `${path}.text must be a string for a text element`)
    if (element.text.length > 100_000) throw fail('INVALID_DOCUMENT', `${path}.text is too long`)
  }
  if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw') {
    assertPoints(element, path)
  }
  if (element.type === 'image') {
    if (typeof element.fileId !== 'string' || element.fileId.length === 0) {
      throw fail('INVALID_DOCUMENT', `${path}.fileId must name an image asset`)
    }
    if (files !== undefined && !Object.hasOwn(files, element.fileId)) {
      throw fail('INVALID_DOCUMENT', `${path}.fileId "${element.fileId}" is missing from files`)
    }
  }
  if (element.link !== null && element.link !== undefined) {
    if (typeof element.link !== 'string') throw fail('INVALID_DOCUMENT', `${path}.link must be a string or null`)
    if (/^\s*javascript:/i.test(element.link)) throw fail('UNSAFE_CONTENT', `${path}.link uses a javascript: URL`)
  }
}

function assertFiles(files) {
  if (!isPlainObject(files)) throw fail('INVALID_DOCUMENT', 'files must be an object')
  let total = 0
  for (const [key, file] of Object.entries(files)) {
    if (!isPlainObject(file)) throw fail('INVALID_DOCUMENT', `files["${key}"] must be an object`)
    if (typeof file.dataURL !== 'string') throw fail('INVALID_DOCUMENT', `files["${key}"].dataURL must be a string`)
    if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/u.test(file.dataURL)) {
      throw fail('UNSAFE_CONTENT', `files["${key}"].dataURL must be a base64 raster image (PNG/JPEG/WebP/GIF)`)
    }
    total += file.dataURL.length
    if (total > LIMITS.maxDocumentBytes) throw fail('DOCUMENT_TOO_LARGE', 'embedded raster image bytes exceed the document limit')
    if (file.mimeType !== undefined && !/^image\/(?:png|jpeg|webp|gif)$/u.test(file.mimeType)) {
      throw fail('UNSAFE_CONTENT', `files["${key}"].mimeType must be a raster image media type`)
    }
    if (file.created !== undefined) assertFiniteNumber(file.created, `files["${key}"].created`)
  }
}

/**
 * Validate one complete Excalidraw source document and reject lossy or unsafe
 * values. Unknown top-level fields and unknown appState fields are preserved.
 * @param {unknown} document parsed JSON document
 * @returns {object} the same document for convenient chaining
 */
export function validateDocument(document) {
  assertLosslessJson(document)
  if (!isPlainObject(document)) throw fail('INVALID_DOCUMENT', 'document must be a JSON object')
  if (document.type !== 'excalidraw') throw fail('INVALID_DOCUMENT', 'document.type must be "excalidraw"')
  if (document.version !== 2) throw fail('INVALID_DOCUMENT', 'document.version must be 2')
  if (!Array.isArray(document.elements)) throw fail('INVALID_DOCUMENT', 'document.elements must be an array')
  if (document.elements.length > LIMITS.maxElements) {
    throw fail('DOCUMENT_TOO_LARGE', `document.elements exceeds ${LIMITS.maxElements} elements`)
  }
  if (document.appState !== undefined && !isPlainObject(document.appState)) {
    throw fail('INVALID_DOCUMENT', 'document.appState must be an object')
  }
  if (document.files !== undefined) assertFiles(document.files)
  const ids = new Set()
  for (const [index, element] of document.elements.entries()) {
    if (!isPlainObject(element)) throw fail('INVALID_DOCUMENT', `elements[${index}] must be an object`)
    if (typeof element.id !== 'string' || element.id.trim().length === 0) {
      throw fail('INVALID_DOCUMENT', `elements[${index}].id must be a non-empty string`)
    }
    if (ids.has(element.id)) throw fail('INVALID_DOCUMENT', `duplicate element id "${element.id}"`)
    ids.add(element.id)
  }
  for (const [index, element] of document.elements.entries()) {
    assertElement(element, `elements[${index}]`, ids, document.files)
    if (element.containerId !== undefined && element.containerId !== null) {
      const container = document.elements.find((candidate) => candidate.id === element.containerId)
      if (container === undefined) {
        throw fail('INVALID_DOCUMENT', `elements[${index}].containerId "${element.containerId}" does not name an element`)
      }
      const bound = Array.isArray(container.boundElements)
        ? container.boundElements.some((binding) => binding.id === element.id)
        : false
      if (!bound) {
        throw fail('INVALID_DOCUMENT', `elements[${index}] is contained by "${element.containerId}" but the container does not bind it`)
      }
    }
  }
  return document
}

/**
 * Serialize one validated source document with the on-disk trailing newline.
 * @param {unknown} document source document
 * @returns {string} UTF-8 text to write
 */
export function serializeDocument(document) {
  validateDocument(document)
  const text = `${JSON.stringify(document, null, 2)}\n`
  if (Buffer.byteLength(text, 'utf8') > LIMITS.maxDocumentBytes) {
    throw fail('DOCUMENT_TOO_LARGE', `source document exceeds ${LIMITS.maxDocumentBytes} bytes`)
  }
  return text
}

/**
 * Parse and validate raw file text.
 * @param {string} text source file text
 * @returns {object} parsed document
 */
export function parseDocument(text) {
  if (typeof text !== 'string') throw fail('INVALID_DOCUMENT', 'source file content must be text')
  if (Buffer.byteLength(text, 'utf8') > LIMITS.maxDocumentBytes) {
    throw fail('DOCUMENT_TOO_LARGE', `source document exceeds ${LIMITS.maxDocumentBytes} bytes`)
  }
  let document
  try {
    document = JSON.parse(text)
  } catch (error) {
    throw fail('INVALID_JSON', `source file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return validateDocument(document)
}

function clone(document) {
  return structuredClone(document)
}

/**
 * Apply 1–200 shallow element patches to a document. New IDs must carry the
 * full geometry and type; `patch.id` is forbidden.
 * @param {object} base validated source document
 * @param {readonly {id: string, patch: object}[]} updates element patches
 * @returns {object} a new validated document
 */
export function applyUpdates(base, updates) {
  if (!Array.isArray(updates) || updates.length < 1 || updates.length > LIMITS.maxPatchElements) {
    throw fail('INVALID_PATCH', `updates must contain 1–${LIMITS.maxPatchElements} patches`)
  }
  const next = clone(base)
  const indexById = new Map(next.elements.map((element, index) => [element.id, index]))
  for (const [updateIndex, update] of updates.entries()) {
    if (!isPlainObject(update)) throw fail('INVALID_PATCH', `updates[${updateIndex}] must be { id, patch }`)
    const { id, patch } = update
    if (typeof id !== 'string' || id.length === 0) {
      throw fail('INVALID_PATCH', `updates[${updateIndex}].id must be a non-empty string`)
    }
    if (!isPlainObject(patch)) throw fail('INVALID_PATCH', `updates[${updateIndex}].patch must be an object`)
    if (Object.hasOwn(patch, 'id')) throw fail('INVALID_PATCH', 'patch.id is forbidden; patches must not rename elements')
    const existingIndex = indexById.get(id)
    if (existingIndex === undefined) {
      if (typeof patch.type !== 'string' || patch.type.length === 0) {
        throw fail('INVALID_PATCH', `new element "${id}" must declare its type`)
      }
      for (const field of ['x', 'y', 'width', 'height']) {
        if (patch[field] === undefined) throw fail('INVALID_PATCH', `new element "${id}" must declare ${field}`)
      }
      next.elements.push({ ...patch, id })
      indexById.set(id, next.elements.length - 1)
    } else {
      next.elements[existingIndex] = { ...next.elements[existingIndex], ...patch }
    }
  }
  return validateDocument(next)
}

/**
 * Merge an editor's element/material changes into the original raw document.
 * Unknown top-level fields and appState fields survive.
 * @param {object} raw original source document
 * @param {{elements: unknown[], files?: object, appStatePatch?: object}} editor editor state
 * @returns {object} merged document
 */
export function mergeEditorState(raw, editor) {
  if (!isPlainObject(editor)) throw fail('INVALID_DOCUMENT', 'editor state must be an object')
  if (!Array.isArray(editor.elements)) throw fail('INVALID_DOCUMENT', 'editor.elements must be an array')
  if (editor.files !== undefined && !isPlainObject(editor.files)) {
    throw fail('INVALID_DOCUMENT', 'editor.files must be an object')
  }
  if (editor.appStatePatch !== undefined && !isPlainObject(editor.appStatePatch)) {
    throw fail('INVALID_DOCUMENT', 'editor.appStatePatch must be an object')
  }
  const document = {
    ...clone(raw),
    elements: clone(editor.elements),
    files: editor.files === undefined ? clone(raw.files ?? {}) : clone(editor.files),
    appState: {
      ...(raw.appState ?? {}),
      ...(editor.appStatePatch ?? {}),
    },
  }
  return validateDocument(document)
}

function clip(value, max = LIMITS.maxSummaryText) {
  if (typeof value !== 'string') return value
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/**
 * Build one bounded element summary.
 * @param {object} document source document
 * @param {{ids?: string[], offset?: number, limit?: number}} [options]
 * @returns {object} page and truncation metadata
 */
export function summarizeElements(document, options = {}) {
  const ids = options.ids
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.length > LIMITS.maxIds) {
      throw fail('INVALID_ARGUMENT', `ids must contain at most ${LIMITS.maxIds} element ids`)
    }
    for (const id of ids) {
      if (typeof id !== 'string' || id.length === 0) throw fail('INVALID_ARGUMENT', 'ids must contain non-empty strings')
    }
  }
  const offset = options.offset ?? 0
  if (!Number.isInteger(offset) || offset < 0) throw fail('INVALID_ARGUMENT', 'offset must be a non-negative integer')
  const limit = options.limit ?? LIMITS.defaultPage
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.maxPage) {
    throw fail('INVALID_ARGUMENT', `limit must be an integer from 1 to ${LIMITS.maxPage}`)
  }
  const selected = ids === undefined
    ? document.elements
    : ids.map((id) => document.elements.find((element) => element.id === id)).filter(Boolean)
  const page = selected.slice(offset, offset + limit)
  const elements = page.map((element) => ({
    id: element.id,
    type: element.type,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    ...(element.angle === undefined ? {} : { angle: element.angle }),
    ...(element.isDeleted === true ? { isDeleted: true } : {}),
    ...(element.text === undefined ? {} : { text: clip(element.text) }),
    ...(element.containerId === undefined ? {} : { containerId: element.containerId }),
    ...(element.type === 'image' ? { fileId: element.fileId } : {}),
    ...(Array.isArray(element.points) ? { pointCount: element.points.length } : {}),
    ...(Array.isArray(element.groupIds) && element.groupIds.length > 0 ? { groupIds: element.groupIds } : {}),
  }))
  const truncated = offset + elements.length < selected.length
  return {
    total: selected.length,
    offset,
    limit,
    returned: elements.length,
    truncated,
    ...(truncated ? { nextOffset: offset + elements.length } : {}),
    elements,
    filesCount: Object.keys(document.files ?? {}).length,
    appStateKeys: Object.keys(document.appState ?? {}),
  }
}

function summarizeValue(value) {
  if (Array.isArray(value)) {
    const shown = value.slice(0, 8)
    const suffix = value.length > shown.length ? ` …(${value.length} items)` : ''
    return `[${shown.map((item) => clip(typeof item === 'string' ? item : JSON.stringify(item), 80)).join(', ')}${suffix}]`
  }
  if (value !== null && typeof value === 'object') {
    if (typeof value.id === 'string') return `{${value.id}}`
    return clip(JSON.stringify(value), 160)
  }
  return typeof value === 'string' ? clip(value, 160) : value
}

/**
 * Compute a bounded, field-level diff between two source documents.
 * Image bytes and unknown private fields never enter the result.
 * @param {object} before previous document
 * @param {object} after next document
 * @param {{fromVersion?: string, toVersion?: string, path?: string}} [meta]
 * @returns {object} changes plus truncation metadata
 */
export function diffDocuments(before, after, meta = {}) {
  const beforeById = new Map((before?.elements ?? []).map((element) => [element.id, element]))
  const afterById = new Map((after?.elements ?? []).map((element) => [element.id, element]))
  const changes = []
  let total = 0
  let truncated = false
  const push = (change) => {
    total += 1
    if (changes.length >= LIMITS.maxDiffItems) {
      truncated = true
      return
    }
    const encoded = JSON.stringify(change)
    if (Buffer.byteLength(JSON.stringify(changes), 'utf8') + Buffer.byteLength(encoded, 'utf8') > LIMITS.maxDiffBytes) {
      truncated = true
      return
    }
    changes.push(change)
  }
  for (const [id, element] of afterById) {
    const previous = beforeById.get(id)
    if (previous === undefined) {
      push({ kind: 'added', id, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height })
      continue
    }
    if (previous.isDeleted !== element.isDeleted) {
      push({ kind: element.isDeleted ? 'soft-deleted' : 'restored', id, type: element.type })
      continue
    }
    const fields = {}
    for (const field of DIFF_FIELDS) {
      const from = previous[field]
      const to = element[field]
      if (JSON.stringify(from) === JSON.stringify(to)) continue
      fields[field] = { from: summarizeValue(from), to: summarizeValue(to) }
    }
    if (Object.keys(fields).length > 0) push({ kind: 'changed', id, type: element.type, fields })
  }
  for (const [id, element] of beforeById) {
    if (afterById.has(id)) continue
    push({ kind: 'removed', id, type: element.type })
  }
  return {
    ...(meta.path === undefined ? {} : { path: meta.path }),
    ...(meta.fromVersion === undefined ? {} : { fromVersion: meta.fromVersion }),
    ...(meta.toVersion === undefined ? {} : { toVersion: meta.toVersion }),
    changes,
    totalChanges: total,
    truncated,
    bytes: Buffer.byteLength(JSON.stringify(changes), 'utf8'),
  }
}

/**
 * Render one bounded diff as a compact model-facing block: one header line per
 * source and one line per element change. Exact versions and raw float noise
 * stay out of the transcript; callers can read the file for authoritative state.
 * @param {object} diff result from {@link diffDocuments}
 * @param {{cwd?: string}} [options] working directory used to shorten the path
 * @returns {string} block text
 */
export function formatDiffForModel(diff, options = {}) {
  const total = diff.totalChanges
  const path = diff.path === undefined ? '(canvas)' : shortenPath(diff.path, options.cwd)
  const lines = [`[canvas] ${path} · ${total} ${total === 1 ? 'change' : 'changes'}`]
  for (const change of diff.changes) lines.push(formatChangeForModel(change))
  const hidden = total - diff.changes.length
  if (hidden > 0) lines.push(`- … +${hidden} more`)
  let text = lines.join('\n')
  if (Buffer.byteLength(text, 'utf8') > LIMITS.maxDiffBytes) {
    text = `${Buffer.from(text, 'utf8').subarray(0, LIMITS.maxDiffBytes - 40).toString('utf8')}\n- … truncated`
  }
  return text
}

function formatChangeForModel(change) {
  const id = JSON.stringify(change.id)
  if (change.kind === 'added') {
    return `- add ${change.type} ${id} at (${formatNumber(change.x)},${formatNumber(change.y)}) ${formatNumber(change.width)}×${formatNumber(change.height)}`
  }
  if (change.kind === 'removed') return `- remove ${change.type} ${id}`
  if (change.kind === 'soft-deleted') return `- delete ${change.type} ${id}`
  if (change.kind === 'restored') return `- restore ${change.type} ${id}`
  const fields = Object.entries(change.fields ?? {})
    .map(([field, value]) => `${field} ${formatValue(value.from)}→${formatValue(value.to)}`)
    .join(', ')
  return `- update ${change.type} ${id}: ${fields}`
}

function formatValue(value) {
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'string' && /[\s,]/.test(value)) return JSON.stringify(value)
  return value === null || value === undefined ? String(value) : value
}

function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value)
  const rounded = Math.round(value * 100) / 100
  return String(rounded === 0 ? 0 : rounded)
}

function shortenPath(path, cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return path
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/**
 * Compute the union bounds of visible elements for export allocation checks.
 * @param {object} document source document
 * @returns {{x: number, y: number, width: number, height: number, count: number}}
 */
export function sceneBounds(document) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let count = 0
  for (const element of document.elements) {
    if (element.isDeleted === true) continue
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
    minX = Math.min(minX, x0)
    minY = Math.min(minY, y0)
    maxX = Math.max(maxX, x1)
    maxY = Math.max(maxY, y1)
    count += 1
  }
  if (count === 0) return { x: 0, y: 0, width: 0, height: 0, count: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, count }
}

export const INTERNAL = Object.freeze({ isPlainObject })

import { describe, expect, test } from 'bun:test'
import {
  LIMITS,
  applyUpdates,
  diffDocuments,
  formatDiffForModel,
  mergeEditorState,
  parseDocument,
  sceneBounds,
  serializeDocument,
  summarizeElements,
  validateDocument,
} from '../src/host/document.js'

function rectangle(id = 'r1', overrides = {}) {
  return {
    id,
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 120,
    height: 60,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: 1,
    version: 1,
    versionNonce: 1,
    updated: 1,
    isDeleted: false,
    boundElements: [],
    link: null,
    locked: false,
    ...overrides,
  }
}

function text(id = 't1', overrides = {}) {
  return {
    id,
    type: 'text',
    x: 20,
    y: 30,
    width: 80,
    height: 24,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 2,
    version: 1,
    versionNonce: 2,
    updated: 2,
    isDeleted: false,
    boundElements: [],
    link: null,
    locked: false,
    text: '用户',
    fontSize: 20,
    fontFamily: 5,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: null,
    originalText: '用户',
    lineHeight: 1.25,
    ...overrides,
  }
}

function documentFixture() {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [rectangle()],
    appState: { viewBackgroundColor: '#ffffff', gridSize: null, collaborators: [] },
    files: {},
    privateExtension: { keep: true },
  }
}

describe('document contract', () => {
  test('accepts a standard document and serializes with one newline', () => {
    const doc = documentFixture()
    validateDocument(doc)
    const textValue = serializeDocument(doc)
    expect(textValue.endsWith('\n')).toBe(true)
    expect(JSON.parse(textValue).privateExtension.keep).toBe(true)
  })

  test('accepts official null boundElements', () => {
    const doc = documentFixture()
    doc.elements[0].boundElements = null
    expect(() => validateDocument(doc)).not.toThrow()
    doc.elements[0].boundElements = 'nope'
    expect(() => validateDocument(doc)).toThrow(/array or null/)
  })

  test('rejects duplicate ids and non-finite geometry', () => {
    const doc = documentFixture()
    doc.elements.push(rectangle('r1'))
    expect(() => validateDocument(doc)).toThrow(/duplicate element id/)
    const second = documentFixture()
    second.elements[0].x = Number.NaN
    expect(() => validateDocument(second)).toThrow(/not representable as lossless JSON/)
  })

  test('rejects external and SVG image assets', () => {
    const external = documentFixture()
    external.elements = [{
      ...rectangle('img', { type: 'image', fileId: 'f1' }),
    }]
    external.files = { f1: { mimeType: 'image/png', dataURL: 'https://example.com/a.png' } }
    expect(() => validateDocument(external)).toThrow(/base64 raster image/)
    const svg = documentFixture()
    svg.elements = [{ ...rectangle('img', { type: 'image', fileId: 'f1' }) }]
    svg.files = { f1: { mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,PHN2Zz4=' } }
    expect(() => validateDocument(svg)).toThrow(/base64 raster image/)
  })

  test('accepts forward bindings and checks container consistency', () => {
    const doc = documentFixture()
    doc.elements = [
      { ...rectangle('arrow', { type: 'arrow', points: [[0, 0], [50, 0]], startBinding: { elementId: 'r1', focus: 0, gap: 0 } }) },
      rectangle('r1', { boundElements: [{ type: 'arrow', id: 'arrow' }] }),
    ]
    expect(() => validateDocument(doc)).not.toThrow()
    const broken = documentFixture()
    broken.elements = [text('t1', { containerId: 'r1' }), rectangle('r1')]
    expect(() => validateDocument(broken)).toThrow(/does not bind it/)
  })

  test('applies shallow patches and preserves raw fields', () => {
    const doc = documentFixture()
    const next = applyUpdates(doc, [
      { id: 'r1', patch: { x: 50, strokeColor: '#ff0000' } },
      { id: 't1', patch: { type: 'text', x: 1, y: 2, width: 3, height: 4, text: '新文字' } },
    ])
    expect(next.elements[0].x).toBe(50)
    expect(next.elements[0].strokeColor).toBe('#ff0000')
    expect(next.elements[1].text).toBe('新文字')
    expect(next.privateExtension.keep).toBe(true)
    expect(doc.elements[0].x).toBe(10)
  })

  test('rejects patch.id and incomplete new elements', () => {
    expect(() => applyUpdates(documentFixture(), [{ id: 'r1', patch: { id: 'renamed' } }])).toThrow(/patch.id/)
    expect(() => applyUpdates(documentFixture(), [{ id: 'new', patch: { type: 'rectangle', x: 1, y: 2, width: 3 } }])).toThrow(/height/)
    expect(() => applyUpdates(documentFixture(), [])).toThrow(/1–200/)
    const tooMany = Array.from({ length: LIMITS.maxPatchElements + 1 }, (_, index) => ({ id: `x${index}`, patch: { isDeleted: true } }))
    expect(() => applyUpdates(documentFixture(), tooMany)).toThrow(/1–200/)
  })

  test('mergeEditorState keeps unknown top-level and appState fields', () => {
    const raw = documentFixture()
    const next = mergeEditorState(raw, {
      elements: [rectangle('r1', { x: 99 })],
      files: {},
      appStatePatch: { viewBackgroundColor: '#fafafa' },
    })
    expect(next.privateExtension.keep).toBe(true)
    expect(next.appState.collaborators).toEqual([])
    expect(next.appState.viewBackgroundColor).toBe('#fafafa')
    expect(next.elements[0].x).toBe(99)
  })

  test('summary paginates, filters ids, and marks truncation', () => {
    const doc = documentFixture()
    doc.elements = Array.from({ length: 7 }, (_, index) => rectangle(`r${index}`, { text: `item ${index}` }))
    const page = summarizeElements(doc, { offset: 2, limit: 3 })
    expect(page.returned).toBe(3)
    expect(page.truncated).toBe(true)
    expect(page.nextOffset).toBe(5)
    expect(page.elements[0].id).toBe('r2')
    const filtered = summarizeElements(doc, { ids: ['r6', 'r1'] })
    expect(filtered.elements.map((element) => element.id)).toEqual(['r6', 'r1'])
    expect(filtered.total).toBe(2)
    expect(() => summarizeElements(doc, { limit: 201 })).toThrow(/limit/)
  })

  test('diff is field-level, bounded, and omits image bytes', () => {
    const before = documentFixture()
    before.elements = [rectangle('r1'), rectangle('r2')]
    const after = structuredClone(before)
    after.elements[0].x = 30
    after.elements[1].isDeleted = true
    after.elements.push(text('t1'))
    const diff = diffDocuments(before, after, { path: '/tmp/a.excalidraw', fromVersion: '1', toVersion: '2' })
    expect(diff.changes.length).toBe(3)
    expect(diff.changes.find((change) => change.id === 'r1')?.fields.x).toEqual({ from: 10, to: 30 })
    expect(diff.changes.find((change) => change.id === 'r2')?.kind).toBe('soft-deleted')
    expect(diff.changes.find((change) => change.id === 't1')?.kind).toBe('added')
    const message = formatDiffForModel(diff, { cwd: '/tmp' })
    expect(message).toContain('[canvas] a.excalidraw · 3 changes')
    expect(message).toContain('- update rectangle "r1": x 10→30')
    expect(message).toContain('- delete rectangle "r2"')
    expect(message).toContain('- add text "t1" at (20,30) 80×24')
    expect(message).not.toContain('data:image')
    expect(message).not.toContain('Version:')
  })

  test('diff truncates at one hundred changes', () => {
    const before = documentFixture()
    before.elements = []
    const after = documentFixture()
    after.elements = Array.from({ length: 150 }, (_, index) => rectangle(`r${index}`))
    const diff = diffDocuments(before, after)
    expect(diff.changes.length).toBe(100)
    expect(diff.truncated).toBe(true)
    expect(diff.totalChanges).toBe(150)
    expect(formatDiffForModel(diff)).toContain('- … +50 more')
  })

  test('scene bounds include points and skip deleted elements', () => {
    const doc = documentFixture()
    doc.elements = [
      rectangle('r1', { x: 10, y: 20, width: 100, height: 50 }),
      rectangle('a1', { type: 'arrow', x: 200, y: 200, width: 0, height: 0, points: [[0, 0], [40, 10]] }),
      rectangle('gone', { isDeleted: true, x: -500, y: -500 }),
    ]
    expect(sceneBounds(doc)).toEqual({ x: 10, y: 20, width: 230, height: 190, count: 2 })
  })

  test('parse rejects malformed JSON and oversized bytes', () => {
    expect(() => parseDocument('{oops')).toThrow(/not valid JSON/)
    expect(() => parseDocument('x'.repeat(LIMITS.maxDocumentBytes + 1))).toThrow(/exceeds/)
  })
})

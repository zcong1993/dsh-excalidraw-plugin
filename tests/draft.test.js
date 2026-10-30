import { describe, expect, test } from 'bun:test'
import {
  DRAFT_MAX_BYTES,
  draftStorageKey,
  loadDraft,
  makeDraft,
  removeDraft,
  saveDraft,
} from '../src/client/draft.js'

class MemoryStorage {
  constructor() {
    this.map = new Map()
    this.quota = Infinity
  }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null }
  setItem(key, value) {
    if (value.length * 2 > this.quota) throw new Error('QuotaExceededError')
    this.map.set(key, value)
  }
  removeItem(key) { this.map.delete(key) }
}

describe('draft protection', () => {
  test('round-trips a draft without a connection token', () => {
    const storage = new MemoryStorage()
    const key = draftStorageKey('session-1', '/tmp/a.excalidraw')
    const draft = makeDraft({
      sessionId: 'session-1',
      path: '/tmp/a.excalidraw',
      baseVersion: 'v1',
      elements: [{ id: 'r1' }],
      files: {},
      appStatePatch: {},
    })
    const result = saveDraft(storage, key, draft)
    expect(result.saved).toBe(true)
    const loaded = loadDraft(storage, key)
    expect(loaded.baseVersion).toBe('v1')
    expect(JSON.stringify(loaded)).not.toContain('token')
  })

  test('refuses a draft over the 2 MiB UTF-16 budget', () => {
    const storage = new MemoryStorage()
    const key = draftStorageKey('s', '/tmp/b.excalidraw')
    const draft = makeDraft({
      sessionId: 's',
      path: '/tmp/b.excalidraw',
      baseVersion: 'v1',
      elements: [{ id: 'r1', text: 'x'.repeat(DRAFT_MAX_BYTES) }],
    })
    const result = saveDraft(storage, key, draft)
    expect(result.saved).toBe(false)
    expect(result.reason).toBe('too-large')
    expect(loadDraft(storage, key)).toBeUndefined()
  })

  test('reports storage refusal instead of claiming success', () => {
    const storage = new MemoryStorage()
    storage.quota = 10
    const key = draftStorageKey('s', '/tmp/c.excalidraw')
    const result = saveDraft(storage, key, makeDraft({
      sessionId: 's', path: '/tmp/c.excalidraw', baseVersion: 'v1', elements: [{ id: 'r1' }],
    }))
    expect(result.saved).toBe(false)
    expect(result.reason).toBe('storage')
  })

  test('remove and corrupt data are safe', () => {
    const storage = new MemoryStorage()
    const key = draftStorageKey('s', '/tmp/d.excalidraw')
    saveDraft(storage, key, makeDraft({ sessionId: 's', path: '/tmp/d.excalidraw', baseVersion: 'v1', elements: [] }))
    removeDraft(storage, key)
    expect(loadDraft(storage, key)).toBeUndefined()
    storage.map.set(key, '{not json')
    expect(loadDraft(storage, key)).toBeUndefined()
  })
})

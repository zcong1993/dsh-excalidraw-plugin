import { describe, expect, test } from 'bun:test'
import {
  editorSnapshot,
  editorSnapshotFromChange,
  liveEditorState,
  resolveEditorState,
} from '../src/client/editor-state.js'

function fakeApi({ elements = [], files = {}, appState = {} } = {}) {
  return {
    getSceneElements: () => elements,
    getFiles: () => files,
    getAppState: () => appState,
  }
}

describe('editor snapshots across unmount', () => {
  test('never reads an API that Excalidraw already reset on unmount', () => {
    const cached = editorSnapshot([{ id: 'rect-1' }], {}, {})
    // Official Excalidraw creates a fresh empty Scene in componentWillUnmount.
    const unmountedApi = fakeApi({ elements: [], files: {} })

    expect(resolveEditorState({
      api: unmountedApi,
      mounted: false,
      cached,
      previousAppState: {},
    })).toBe(cached)
  })

  test('reads the live scene while mounted and keeps only durable appState', () => {
    const api = fakeApi({
      elements: [{ id: 'rect-1' }],
      files: { file1: { dataURL: 'data:image/png;base64,AA==', mimeType: 'image/png' } },
      appState: { viewBackgroundColor: '#ffcc00', scrollX: 100, selectedElementIds: { 'rect-1': true } },
    })

    const state = liveEditorState(api, { viewBackgroundColor: '#ffffff' })

    expect(state.elements).toEqual([{ id: 'rect-1' }])
    expect(state.files).toEqual(api.getFiles())
    expect(state.appStatePatch).toEqual({ viewBackgroundColor: '#ffcc00' })
  })

  test('falls back to the cached snapshot when the API is not ready', () => {
    const cached = editorSnapshot([{ id: 'text-1' }], {}, {})

    expect(resolveEditorState({
      api: undefined,
      mounted: true,
      cached,
      previousAppState: {},
    })).toBe(cached)
  })

  test('marks element, file, and appState edits as different snapshots', () => {
    const base = editorSnapshot([{ id: 'r1' }], {}, {})
    const elementEdit = editorSnapshot([{ id: 'r1' }, { id: 'r2' }], {}, {})
    const fileEdit = editorSnapshot([{ id: 'r1' }], { f1: { dataURL: 'data:image/png;base64,AA==' } }, {})
    const appStateEdit = editorSnapshot([{ id: 'r1' }], {}, { viewBackgroundColor: '#000000' })

    expect(new Set([base.signature, elementEdit.signature, fileEdit.signature, appStateEdit.signature]).size).toBe(4)
  })

  test('captures an onChange payload without viewport or selection state', () => {
    const snapshot = editorSnapshotFromChange(
      [{ id: 'r1' }],
      {},
      { viewBackgroundColor: '#ffffff', scrollX: 80, selectedElementIds: { r1: true } },
      { viewBackgroundColor: '#000000' },
    )

    expect(snapshot.appStatePatch).toEqual({ viewBackgroundColor: '#ffffff' })
    expect(JSON.stringify(snapshot.appStatePatch)).not.toContain('scrollX')
  })
})

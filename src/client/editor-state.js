/** Editor snapshots that remain valid after the Excalidraw child unmounts. */

import { filesSignature, pickAppStatePatch } from './geometry.js'

function signatureOf(elements, files, appStatePatch) {
  return `${JSON.stringify(elements)}|${filesSignature(files)}|${JSON.stringify(appStatePatch)}`
}

/**
 * One immutable-enough snapshot of what the user edited. `elements` and `files`
 * come straight from Excalidraw and are replaced, never mutated, on each change.
 */
export function editorSnapshot(elements, files, appStatePatch = {}) {
  const normalizedFiles = files ?? {}
  return {
    elements,
    files: normalizedFiles,
    appStatePatch,
    signature: signatureOf(elements, normalizedFiles, appStatePatch),
  }
}

/** Snapshot an `onChange` payload, keeping only durable appState fields. */
export function editorSnapshotFromChange(elements, files, appState, previousAppState = {}) {
  return editorSnapshot(elements, files, pickAppStatePatch(appState, previousAppState))
}

export function liveEditorState(api, previousAppState = {}) {
  const elements = api.getSceneElements()
  const files = api.getFiles()
  const appState = api.getAppState()
  const appStatePatch = pickAppStatePatch(appState, previousAppState)
  return editorSnapshot(elements, files, appStatePatch)
}

/**
 * Official Excalidraw resets its scene in `componentWillUnmount`, before a
 * parent passive-effect cleanup runs. Reading the API then returns an empty
 * canvas, so an unmounting body must commit the last snapshot captured from
 * `onChange` instead.
 */
export function resolveEditorState({ api, mounted, cached, previousAppState }) {
  if (!mounted || api === undefined) return cached
  return liveEditorState(api, previousAppState)
}

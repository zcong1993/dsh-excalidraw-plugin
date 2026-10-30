/** Bounded browser draft persistence for Excalidraw canvases. */

export const DRAFT_VERSION = 1
export const DRAFT_MAX_BYTES = 2 * 1024 * 1024

export function draftStorageKey(sessionId, path) {
  return `dsh.excalidraw.draft.v1.${encodeURIComponent(sessionId)}.${encodeURIComponent(path)}`
}

export function estimateUtf16Bytes(text) {
  return typeof text === 'string' ? text.length * 2 : 0
}

export function makeDraft(input) {
  return {
    version: DRAFT_VERSION,
    sessionId: input.sessionId,
    path: input.path,
    baseVersion: input.baseVersion,
    savedAt: Date.now(),
    elements: input.elements,
    files: input.files ?? {},
    appStatePatch: input.appStatePatch ?? {},
  }
}

/**
 * Persist one draft without ever storing a connection token.
 * @param {Storage} storage browser sessionStorage-like storage
 * @param {string} key draft key
 * @param {object} draft draft value
 * @returns {{saved: true, bytes: number} | {saved: false, reason: 'too-large'|'storage', bytes: number}}
 */
export function saveDraft(storage, key, draft) {
  let text
  try {
    text = JSON.stringify(draft)
  } catch {
    return { saved: false, reason: 'storage', bytes: 0 }
  }
  const bytes = estimateUtf16Bytes(text)
  if (bytes > DRAFT_MAX_BYTES) return { saved: false, reason: 'too-large', bytes }
  try {
    storage.setItem(key, text)
    return { saved: true, bytes }
  } catch {
    return { saved: false, reason: 'storage', bytes }
  }
}

export function loadDraft(storage, key) {
  try {
    const text = storage.getItem(key)
    if (text === null) return undefined
    if (estimateUtf16Bytes(text) > DRAFT_MAX_BYTES) return undefined
    const value = JSON.parse(text)
    if (value?.version !== DRAFT_VERSION) return undefined
    if (typeof value.sessionId !== 'string' || typeof value.path !== 'string') return undefined
    if (!Array.isArray(value.elements)) return undefined
    return value
  } catch {
    return undefined
  }
}

export function removeDraft(storage, key) {
  try {
    storage.removeItem(key)
  } catch {
    // A refused removal leaves a recoverable draft rather than losing content.
  }
}

export function downloadDraft(draft, filename) {
  const document = {
    type: 'excalidraw',
    version: 2,
    elements: draft.elements ?? [],
    appState: draft.appStatePatch ?? {},
    files: draft.files ?? {},
  }
  const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = documentElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function documentElement(tag) {
  return globalThis.document.createElement(tag)
}

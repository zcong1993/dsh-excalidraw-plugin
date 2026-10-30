/** Browser HTTP client for the plugin's Host edit/export surface. */

export class ApiError extends Error {
  constructor(code, message, currentVersion) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.currentVersion = currentVersion
  }
}

function isAbort(error) {
  return error?.name === 'AbortError'
}

async function requestPath(path, { method = 'POST', body, timeoutMs = 20000, signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combined,
    })
    const text = await response.text()
    let payload
    try {
      payload = text.length === 0 ? undefined : JSON.parse(text)
    } catch {
      throw new ApiError('BAD_RESPONSE', `the Host returned a non-JSON response (HTTP ${response.status})`)
    }
    if (payload?.ok === true) return payload.value
    const error = payload?.error
    if (error !== undefined) {
      throw new ApiError(error.code ?? 'REQUEST_FAILED', error.message ?? 'request failed', error.currentVersion)
    }
    throw new ApiError('REQUEST_FAILED', `HTTP ${response.status}`)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (isAbort(error)) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      throw new ApiError('TIMEOUT', 'the Host did not answer in time')
    }
    throw new ApiError('OFFLINE', 'cannot reach the DSH Host')
  } finally {
    clearTimeout(timer)
  }
}

function body(id) {
  return {
    sessionId: id.sessionId,
    token: id.token,
    path: id.path,
  }
}

export function createCanvasApi(id) {
  return {
    id,
    open(token) {
      return requestPath('/api/excalidraw-edit/open', {
        body: { sessionId: id.sessionId, path: id.path, ...(token === undefined ? {} : { token }) },
      })
    },
    snapshot() {
      return requestPath('/api/excalidraw-edit/snapshot', { body: body(id) })
    },
    commit(input) {
      return requestPath('/api/excalidraw-edit/commit', {
        body: { ...body(id), ...input },
        timeoutMs: 25000,
      })
    },
    poll(input) {
      return requestPath('/api/excalidraw-edit/poll', {
        body: { ...body(id), ...input },
        timeoutMs: 8000,
      })
    },
    ack(input) {
      return requestPath('/api/excalidraw-edit/ack', {
        body: { ...body(id), ...input },
        timeoutMs: 8000,
      })
    },
    close() {
      return requestPath('/api/excalidraw-edit/close', { body: body(id), timeoutMs: 8000 }).catch(() => undefined)
    },
    claimExport(taskId) {
      return requestPath('/api/excalidraw-export/claim', {
        body: { sessionId: id.sessionId, token: id.token, taskId },
        timeoutMs: 15000,
      })
    },
    resultExport(taskId, input) {
      return requestPath('/api/excalidraw-export/result', {
        body: {
          sessionId: id.sessionId,
          token: id.token,
          taskId,
          version: input.version,
          format: input.format,
          data: input.data,
        },
        timeoutMs: 60000,
        signal: input.signal,
      })
    },
    failExport(taskId, message) {
      return requestPath('/api/excalidraw-export/fail', {
        body: { sessionId: id.sessionId, token: id.token, taskId, message },
        timeoutMs: 10000,
      }).catch(() => undefined)
    },
  }
}

export async function pendingPreview(sessionId) {
  return requestPath('/api/excalidraw-preview/pending', { body: { sessionId }, timeoutMs: 8000 })
}

export async function markPreviewOpened(sessionId, token) {
  return requestPath('/api/excalidraw-preview/opened', { body: { sessionId, token }, timeoutMs: 8000 })
}

export { requestPath }

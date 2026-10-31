import { afterEach, describe, expect, test } from 'bun:test'
import {
  ApiError,
  createCanvasApi,
  markPreviewOpened,
  pendingPreview,
  requestPath,
} from '../src/client/api.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function recordFetch(handler = () => jsonResponse({ ok: true, value: { done: true } })) {
  const calls = []
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init })
    return handler(path, init)
  }
  return calls
}

describe('browser Host API', () => {
  test('posts JSON with the expected headers and credentials', async () => {
    const calls = recordFetch()
    await expect(requestPath('/api/x', { body: { a: 1 } })).resolves.toEqual({ done: true })
    expect(calls[0].path).toBe('/api/x')
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: '{"a":1}',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    })

    await requestPath('/api/y')
    expect(calls[1].init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: undefined,
      headers: { Accept: 'application/json' },
    })
  })

  test('returns the unwrapped value', async () => {
    recordFetch(() => jsonResponse({ ok: true, value: { version: 'v1' } }))
    await expect(requestPath('/api/x', { body: {} })).resolves.toEqual({ version: 'v1' })
  })

  test('maps an error envelope onto ApiError with the current version', async () => {
    recordFetch(() => jsonResponse({
      ok: false,
      error: { code: 'VERSION_CONFLICT', message: 'stale baseline', currentVersion: 'v4' },
    }))
    const error = await requestPath('/api/x', { body: {} }).catch((caught) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      name: 'ApiError',
      code: 'VERSION_CONFLICT',
      message: 'stale baseline',
      currentVersion: 'v4',
    })
  })

  test('reports non-JSON and envelopeless responses', async () => {
    recordFetch(() => new Response('<html>oops</html>', { status: 502 }))
    const bad = await requestPath('/api/x', { body: {} }).catch((caught) => caught)
    expect(bad).toMatchObject({ code: 'BAD_RESPONSE' })
    expect(bad.message).toContain('HTTP 502')

    recordFetch(() => jsonResponse({ nope: true }, 500))
    const missing = await requestPath('/api/x', { body: {} }).catch((caught) => caught)
    expect(missing).toMatchObject({ code: 'REQUEST_FAILED', message: 'HTTP 500' })
  })

  test('maps network failures to OFFLINE', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('network down')
    }
    const error = await requestPath('/api/x', { body: {} }).catch((caught) => caught)
    expect(error).toMatchObject({ code: 'OFFLINE' })
  })

  test('maps its own timeout to TIMEOUT', async () => {
    globalThis.fetch = (_path, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
    const error = await requestPath('/api/x', { body: {}, timeoutMs: 5 }).catch((caught) => caught)
    expect(error).toMatchObject({ code: 'TIMEOUT' })
  })

  test('propagates caller aborts as AbortError', async () => {
    globalThis.fetch = (_path, init) => new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'AbortError'))
      if (init.signal.aborted) abort()
      else init.signal.addEventListener('abort', abort)
    })
    const controller = new AbortController()
    controller.abort()
    const error = await requestPath('/api/x', { body: {}, signal: controller.signal }).catch((caught) => caught)
    expect(error).toMatchObject({ name: 'AbortError' })
  })

  test('builds every edit and export request body', async () => {
    const calls = recordFetch()
    const api = createCanvasApi({ sessionId: 's1', token: 'tok', path: 'a.excalidraw' })

    await api.open()
    await api.open('preview-token')
    await api.snapshot()
    await api.commit({ baseVersion: 'v1', opId: 'op', elements: [] })
    await api.poll({ dirty: true })
    await api.ack({ flushId: 'f1' })
    await api.close()
    await api.claimExport('t1')
    await api.resultExport('t1', { version: 'v1', format: 'png', data: 'AA==' })
    await api.failExport('t1', 'boom')

    expect(calls.map((call) => call.path)).toEqual([
      '/api/excalidraw-edit/open',
      '/api/excalidraw-edit/open',
      '/api/excalidraw-edit/snapshot',
      '/api/excalidraw-edit/commit',
      '/api/excalidraw-edit/poll',
      '/api/excalidraw-edit/ack',
      '/api/excalidraw-edit/close',
      '/api/excalidraw-export/claim',
      '/api/excalidraw-export/result',
      '/api/excalidraw-export/fail',
    ])
    expect(JSON.parse(calls[0].init.body)).toEqual({ sessionId: 's1', path: 'a.excalidraw' })
    expect(JSON.parse(calls[1].init.body)).toEqual({ sessionId: 's1', path: 'a.excalidraw', token: 'preview-token' })
    expect(JSON.parse(calls[2].init.body)).toEqual({ sessionId: 's1', token: 'tok', path: 'a.excalidraw' })
    expect(JSON.parse(calls[3].init.body)).toMatchObject({
      sessionId: 's1', token: 'tok', path: 'a.excalidraw', baseVersion: 'v1', opId: 'op', elements: [],
    })
    expect(JSON.parse(calls[4].init.body)).toMatchObject({ dirty: true })
    expect(JSON.parse(calls[7].init.body)).toEqual({ sessionId: 's1', token: 'tok', taskId: 't1' })
    expect(JSON.parse(calls[8].init.body)).toMatchObject({ taskId: 't1', version: 'v1', format: 'png', data: 'AA==' })
    expect(JSON.parse(calls[9].init.body)).toMatchObject({ taskId: 't1', message: 'boom' })
  })

  test('swallows close and fail errors', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('offline')
    }
    const api = createCanvasApi({ sessionId: 's1', token: 'tok', path: 'a.excalidraw' })
    await expect(api.close()).resolves.toBeUndefined()
    await expect(api.failExport('t1', 'boom')).resolves.toBeUndefined()
  })

  test('sends preview pending and opened requests', async () => {
    const calls = recordFetch()
    await pendingPreview('s1')
    await markPreviewOpened('s1', 'pt')
    expect(calls.map((call) => call.path)).toEqual([
      '/api/excalidraw-preview/pending',
      '/api/excalidraw-preview/opened',
    ])
    expect(JSON.parse(calls[0].init.body)).toEqual({ sessionId: 's1' })
    expect(JSON.parse(calls[1].init.body)).toEqual({ sessionId: 's1', token: 'pt' })
  })
})

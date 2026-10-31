import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { applyRoutes, serveAsset } from '../src/host/routes.js'
import { ExcalidrawError } from '../src/host/document.js'
import { MAX_BODY_BYTES } from '../src/host/service.js'

const ownerAdmission = () => ({ peer: { principal: { kind: 'owner' } } })

function fakeRouteContext(admit = ownerAdmission) {
  const routes = new Map()
  const ctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => {}
      },
    },
    connection: { admit: (req) => admit(req) },
  }
  return { ctx, routes }
}

function fakeService(overrides = {}) {
  const calls = []
  const record = (name, value) => calls.push({ name, value })
  const base = {
    openCanvas: async (input) => { record('openCanvas', input); return { opened: input.path } },
    snapshot: async (input) => { record('snapshot', input); return { snapshot: true } },
    commit: async (input) => { record('commit', input); return { version: 'v2' } },
    pollAsync: async (input) => { record('pollAsync', input); return { version: 'v1' } },
    ack: async (input) => { record('ack', input); return { acknowledged: true } },
    close: async (input) => { record('close', input); return { closed: true } },
    pendingPreview: (sessionId) => {
      record('pendingPreview', sessionId)
      return undefined
    },
    markPreviewOpened: (sessionId, token) => {
      record('markPreviewOpened', { sessionId, token })
    },
    getDownload: (tokenValue) => {
      record('getDownload', tokenValue)
      if (tokenValue !== 'download-token') throw new ExcalidrawError('DOWNLOAD_EXPIRED', 'expired')
      return { data: Buffer.from('png-body'), name: 'a.png', format: 'png' }
    },
    sourceExport: async (input) => { record('sourceExport', input); return { document: {} } },
    claimExport: async (input) => { record('claimExport', input); return { taskId: input.taskId } },
    failExport: async (input) => { record('failExport', input); return { failed: true } },
    resultExport: async (input) => { record('resultExport', input); return { bytes: 1 } },
  }
  return { service: { ...base, ...overrides }, calls }
}

function httpRequest({ method = 'POST', url = '/', body, headers = {} } = {}) {
  const chunks = []
  if (body !== undefined) chunks.push(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
  const merged = { ...headers }
  if (body !== undefined && merged['content-length'] === undefined) {
    merged['content-length'] = String(chunks[0].byteLength)
  }
  return {
    method,
    url,
    headers: merged,
    async *[Symbol.asyncIterator]() {
      yield* chunks
    },
  }
}

function makeResponse() {
  const chunks = []
  const res = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk))
      done()
    },
  })
  res.status = undefined
  res.headers = {}
  res.headersSent = false
  res.writeHead = (status, headers = {}) => {
    res.status = status
    res.headers = { ...headers }
    res.headersSent = true
  }
  res.body = () => Buffer.concat(chunks)
  res.json = () => JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return res
}

async function assetRequest(request, root = assetRoot) {
  const res = makeResponse()
  await serveAsset(request, res, root)
  await finished(res)
  return res
}

async function callRoute(routes, path, request) {
  const handler = routes.get(path)
  if (handler === undefined) throw new Error(`route ${path} is not registered`)
  const res = makeResponse()
  await handler(request, res)
  await finished(res)
  return res
}

function setupRoutes(overrides, admit) {
  const { service, calls } = fakeService(overrides)
  const { ctx, routes } = fakeRouteContext(admit)
  applyRoutes(ctx, service)
  return { service, calls, routes }
}

await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
const assetRoot = await mkdtemp(join(process.cwd(), '.tmp', 'routes-assets-'))
await mkdir(join(assetRoot, 'nested'), { recursive: true })
await writeFile(join(assetRoot, 'probe.woff2'), Buffer.from('font-bytes'))
await writeFile(join(assetRoot, 'site.css'), 'body{}')
await writeFile(join(assetRoot, 'nested', 'note.txt'), 'nested')
await writeFile(join(assetRoot, 'raw.bin'), 'binary')

afterAll(async () => {
  await rm(assetRoot, { recursive: true, force: true })
})

describe('host HTTP routes', () => {
  test('admits only owner connections', async () => {
    const unauthorized = setupRoutes({}, () => ({ rejection: 401 }))
    const denied = await callRoute(unauthorized.routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/open', body: { sessionId: 's1' } }))
    expect(denied.status).toBe(401)
    expect(denied.json().error.code).toBe('UNAUTHORIZED')

    const viewer = setupRoutes({}, () => ({ peer: { principal: { kind: 'viewer' } } }))
    const forbidden = await callRoute(viewer.routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/open', body: { sessionId: 's1' } }))
    expect(forbidden.status).toBe(403)
    expect(forbidden.json().error.code).toBe('FORBIDDEN')
    expect(viewer.calls).toHaveLength(0)
  })

  test('rejects non-POST edit requests', async () => {
    const { routes } = setupRoutes({})
    const res = await callRoute(routes, '/api/excalidraw-edit',
      httpRequest({ method: 'GET', url: '/api/excalidraw-edit/open' }))
    expect(res.status).toBe(405)
    expect(res.json().error.code).toBe('METHOD_NOT_ALLOWED')
  })

  test('dispatches every edit endpoint with the expected fields', async () => {
    const { routes, calls } = setupRoutes({})
    const base = { sessionId: 's1', token: 'tok', path: 'a.excalidraw' }

    await callRoute(routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/open', body: base }))
    await callRoute(routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/snapshot', body: base }))
    await callRoute(routes, '/api/excalidraw-edit',
      httpRequest({
        url: '/api/excalidraw-edit/commit',
        body: {
          ...base,
          baseVersion: 'v1',
          opId: 'op-1',
          elements: [],
          files: {},
          appStatePatch: {},
          document: undefined,
          flushId: 'f1',
        },
      }))
    await callRoute(routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/poll', body: { ...base, knownVersion: 'v1', dirty: true } }))
    await callRoute(routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/ack', body: { ...base, flushId: 'f1', version: 'v2' } }))
    await callRoute(routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/close', body: base }))

    expect(calls.map((call) => call.name)).toEqual(['openCanvas', 'snapshot', 'commit', 'pollAsync', 'ack', 'close'])
    expect(calls[0].value).toEqual({ sessionId: 's1', path: 'a.excalidraw', token: 'tok', signal: undefined })
    expect(calls[2].value).toMatchObject({
      sessionId: 's1', token: 'tok', path: 'a.excalidraw', baseVersion: 'v1', opId: 'op-1', flushId: 'f1',
    })
    expect(calls[3].value).toMatchObject({ knownVersion: 'v1', dirty: true })
    expect(calls[4].value).toMatchObject({ flushId: 'f1', version: 'v2' })
  })

  test('returns 404 for an unknown edit endpoint', async () => {
    const { routes } = setupRoutes({})
    const res = await callRoute(routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/nope', body: {} }))
    expect(res.status).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  test('refuses oversized bodies before reading them', async () => {
    const { routes } = setupRoutes({})
    const res = await callRoute(routes, '/api/excalidraw-edit',
      httpRequest({
        url: '/api/excalidraw-edit/open',
        headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
      }))
    expect(res.status).toBe(400)
    expect(res.json().error.message).toContain('48 MiB')
  })

  test('refuses malformed JSON and treats an empty body as an empty object', async () => {
    const broken = setupRoutes({})
    const bad = await callRoute(broken.routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/open', body: '{' }))
    expect(bad.status).toBe(400)
    expect(bad.json().error.message).toContain('valid JSON')

    const empty = setupRoutes({})
    await callRoute(empty.routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/open' }))
    expect(empty.calls[0].value).toMatchObject({ sessionId: undefined, path: undefined, token: undefined })
  })

  test('maps stable error codes onto HTTP statuses', async () => {
    const cases = [
      ['NOT_OPEN', 401],
      ['UNAUTHORIZED', 401],
      ['PERMISSION_DENIED', 403],
      ['PATH_IDENTITY_CHANGED', 403],
      ['TRANSACTION_DENIED', 403],
      ['NOT_FOUND', 404],
      ['DOWNLOAD_EXPIRED', 404],
      ['TRANSACTION_NOT_FOUND', 404],
      ['VERSION_CONFLICT', 409],
      ['EXPORT_VERSION_CONFLICT', 409],
      ['LOCKED', 409],
      ['PATH_EXISTS', 409],
      ['EXPORT_TIMEOUT', 504],
      ['INVALID_ARGUMENT', 400],
      ['SOMETHING_NEW', 400],
    ]
    for (const [code, status] of cases) {
      const { routes } = setupRoutes({
        openCanvas: async () => {
          throw new ExcalidrawError(code, `failed with ${code}`, code === 'VERSION_CONFLICT' ? { currentVersion: 'v9' } : {})
        },
      })
      const res = await callRoute(routes, '/api/excalidraw-edit',
        httpRequest({ url: '/api/excalidraw-edit/open', body: { sessionId: 's1' } }))
      expect(res.status).toBe(status)
      expect(res.json().error.code).toBe(code)
      if (code === 'VERSION_CONFLICT') expect(res.json().error.currentVersion).toBe('v9')
      else expect('currentVersion' in res.json().error).toBe(false)
    }
  })

  test('turns an unexpected exception into a stable internal error', async () => {
    const { routes } = setupRoutes({
      openCanvas: async () => {
        throw new TypeError('boom')
      },
    })
    const res = await callRoute(routes, '/api/excalidraw-edit',
      httpRequest({ url: '/api/excalidraw-edit/open', body: { sessionId: 's1' } }))
    expect(res.status).toBe(400)
    expect(res.json().error).toMatchObject({ code: 'INTERNAL', message: 'boom' })
  })

  test('serves preview pending and opened requests', async () => {
    const { routes, calls } = setupRoutes({})
    const pending = await callRoute(routes, '/api/excalidraw-preview',
      httpRequest({ url: '/api/excalidraw-preview/pending', body: { sessionId: 's1' } }))
    expect(pending.status).toBe(200)
    expect(pending.json()).toEqual({ ok: true, value: null })

    await callRoute(routes, '/api/excalidraw-preview',
      httpRequest({ url: '/api/excalidraw-preview/opened', body: { sessionId: 's1', token: 'pt' } }))
    expect(calls.map((call) => call.name)).toEqual(['pendingPreview', 'markPreviewOpened'])
    expect(calls[1].value).toEqual({ sessionId: 's1', token: 'pt' })

    const unknown = await callRoute(routes, '/api/excalidraw-preview',
      httpRequest({ url: '/api/excalidraw-preview/unknown', body: {} }))
    expect(unknown.status).toBe(404)
  })

  test('serves export source and task endpoints', async () => {
    const { routes, calls } = setupRoutes({})
    const source = await callRoute(routes, '/api/excalidraw-export',
      httpRequest({
        method: 'GET',
        url: '/api/excalidraw-export/source?taskId=t1&sessionId=s1&token=tok',
      }))
    expect(source.status).toBe(200)
    expect(calls[0]).toEqual({
      name: 'sourceExport',
      value: { taskId: 't1', sessionId: 's1', token: 'tok' },
    })

    await callRoute(routes, '/api/excalidraw-export',
      httpRequest({ url: '/api/excalidraw-export/claim', body: { taskId: 't1', sessionId: 's1', token: 'tok' } }))
    await callRoute(routes, '/api/excalidraw-export',
      httpRequest({ url: '/api/excalidraw-export/fail', body: { taskId: 't1', sessionId: 's1', token: 'tok', message: 'nope' } }))
    await callRoute(routes, '/api/excalidraw-export',
      httpRequest({ url: '/api/excalidraw-export/result', body: { taskId: 't1', sessionId: 's1', token: 'tok', version: 'v1', format: 'png', data: 'AA==' } }))
    expect(calls[1].value).toMatchObject({ taskId: 't1', signal: undefined })
    expect(calls[2].value).toMatchObject({ taskId: 't1', message: 'nope' })
    expect(calls[3].value).toMatchObject({ version: 'v1', format: 'png', data: 'AA==' })

    const wrongMethod = await callRoute(routes, '/api/excalidraw-export',
      httpRequest({ method: 'POST', url: '/api/excalidraw-export/source' }))
    expect(wrongMethod.status).toBe(405)

    const unknown = await callRoute(routes, '/api/excalidraw-export',
      httpRequest({ url: '/api/excalidraw-export/unknown', body: {} }))
    expect(unknown.status).toBe(404)
  })

  test('streams an export download without requiring owner admission', async () => {
    const { routes } = setupRoutes({}, () => ({ rejection: 401 }))
    const res = await callRoute(routes, '/api/excalidraw-export',
      httpRequest({ method: 'GET', url: '/api/excalidraw-export/download?token=download-token' }))
    expect(res.status).toBe(200)
    expect(res.headers['Content-Type']).toBe('image/png')
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="a.png"')
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(res.body().toString('utf8')).toBe('png-body')

    const head = await callRoute(routes, '/api/excalidraw-export',
      httpRequest({ method: 'HEAD', url: '/api/excalidraw-export/download?token=download-token' }))
    expect(head.status).toBe(200)
    expect(head.body()).toHaveLength(0)

    const wrongMethod = await callRoute(routes, '/api/excalidraw-export',
      httpRequest({ method: 'POST', url: '/api/excalidraw-export/download?token=download-token' }))
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.Allow).toBe('GET, HEAD')

    const expired = await callRoute(routes, '/api/excalidraw-export',
      httpRequest({ method: 'GET', url: '/api/excalidraw-export/download?token=expired' }))
    expect(expired.status).toBe(404)
    expect(expired.json().error.code).toBe('DOWNLOAD_EXPIRED')
  })

  test('escapes the download filename and uses the SVG content type', async () => {
    const { routes } = setupRoutes({
      getDownload: () => ({ data: Buffer.from('<svg/>'), name: 'a"b\\.svg', format: 'svg' }),
    })
    const res = await callRoute(routes, '/api/excalidraw-export',
      httpRequest({ method: 'GET', url: '/api/excalidraw-export/download?token=x' }))
    expect(res.headers['Content-Type']).toBe('image/svg+xml; charset=utf-8')
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="a_b_.svg"')
    expect(res.body().toString('utf8')).toBe('<svg/>')
  })

  test('serves scoped static assets with MIME and cache headers', async () => {
    const font = await assetRequest(
      httpRequest({ method: 'GET', url: '/api/excalidraw-assets/probe.woff2' }),
    )
    expect(font.status).toBe(200)
    expect(font.headers['Content-Type']).toBe('font/woff2')
    expect(font.headers['Cache-Control']).toBe('public, max-age=31536000, immutable')
    expect(font.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(font.headers['Content-Length']).toBe(10)
    expect(font.body().toString('utf8')).toBe('font-bytes')

    const css = await assetRequest(
      httpRequest({ method: 'GET', url: '/api/excalidraw-assets/site.css' }),
    )
    expect(css.headers['Content-Type']).toBe('text/css; charset=utf-8')
    expect(css.headers['Cache-Control']).toBe('no-cache')

    const head = await assetRequest(
      httpRequest({ method: 'HEAD', url: '/api/excalidraw-assets/site.css' }),
    )
    expect(head.status).toBe(200)
    expect(head.headers['Content-Length']).toBe(6)
    expect(head.body()).toHaveLength(0)

    const unknown = await assetRequest(
      httpRequest({ method: 'GET', url: '/api/excalidraw-assets/raw.bin' }),
    )
    expect(unknown.headers['Content-Type']).toBe('application/octet-stream')
  })

  test('rejects asset traversal, invalid escapes, directories, and non-read methods', async () => {
    const traversal = await assetRequest(
      httpRequest({ method: 'GET', url: '/api/excalidraw-assets/..%2Foutside.txt' }),
    )
    expect(traversal.status).toBe(404)

    const absolute = await assetRequest(
      httpRequest({ method: 'GET', url: '/api/excalidraw-assets/%2Fetc%2Fpasswd' }),
    )
    expect(absolute.status).toBe(404)

    const badEscape = await assetRequest(
      httpRequest({ method: 'GET', url: '/api/excalidraw-assets/%E0%A4%A' }),
    )
    expect(badEscape.status).toBe(400)

    const directory = await assetRequest(
      httpRequest({ method: 'GET', url: '/api/excalidraw-assets/nested' }),
    )
    expect(directory.status).toBe(404)

    const missing = await assetRequest(
      httpRequest({ method: 'GET', url: '/api/excalidraw-assets/missing.woff2' }),
    )
    expect(missing.status).toBe(404)

    const outsidePrefix = await assetRequest(
      httpRequest({ method: 'GET', url: '/api/excalidraw-other/probe.woff2' }),
    )
    expect(outsidePrefix.status).toBe(404)

    const post = await assetRequest(
      httpRequest({ method: 'POST', url: '/api/excalidraw-assets/probe.woff2' }),
    )
    expect(post.status).toBe(405)
    expect(post.headers.Allow).toBe('GET, HEAD')
  })
})

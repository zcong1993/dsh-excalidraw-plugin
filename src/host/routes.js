import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentVersionOf, MAX_BODY_BYTES, errorCode, messageFor, toError } from './service.js'

const ASSET_PREFIX = '/api/excalidraw-assets/'
const ASSET_ROOT = fileURLToPath(new URL('./assets/', import.meta.url))

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
}

function statusFor(code) {
  switch (code) {
    case 'UNAUTHORIZED':
    case 'NOT_OPEN':
      return 401
    case 'PERMISSION_DENIED':
    case 'PATH_IDENTITY_CHANGED':
    case 'TRANSACTION_DENIED':
      return 403
    case 'NOT_FOUND':
    case 'DOWNLOAD_EXPIRED':
    case 'TRANSACTION_NOT_FOUND':
      return 404
    case 'VERSION_CONFLICT':
    case 'EXPORT_VERSION_CONFLICT':
    case 'LOCKED':
    case 'PATH_EXISTS':
      return 409
    case 'EXPORT_TIMEOUT':
      return 504
    default:
      return 400
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function sendOk(res, value) {
  sendJson(res, 200, { ok: true, value })
}

function sendError(res, error) {
  const mapped = toError(error)
  const currentVersion = currentVersionOf(mapped)
  sendJson(res, statusFor(mapped.code), {
    ok: false,
    error: {
      code: mapped.code,
      message: messageFor(mapped),
      ...(currentVersion === undefined ? {} : { currentVersion }),
    },
  })
}

async function readBody(req) {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new Error('request body exceeds the 48 MiB limit')
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.byteLength
    if (total > MAX_BODY_BYTES) throw new Error('request body exceeds the 48 MiB limit')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('request body must be valid JSON')
  }
}

function authenticate(ctx, req, res) {
  const admission = ctx.connection.admit(req)
  if ('rejection' in admission) {
    sendJson(res, admission.rejection, {
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'this request is not authenticated for the Harness owner' },
    })
    return undefined
  }
  if (admission.peer.principal.kind !== 'owner') {
    sendJson(res, 403, {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Excalidraw editing is available only to the Harness owner' },
    })
    return undefined
  }
  return admission.peer
}

function pathnameOf(req) {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  } catch {
    return req.url ?? '/'
  }
}

function queryOf(req) {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
  } catch {
    return new URLSearchParams()
  }
}

async function withOwner(ctx, req, res, handler) {
  const peer = authenticate(ctx, req, res)
  if (peer === undefined) return
  try {
    await handler(peer)
  } catch (error) {
    sendError(res, error)
  }
}

async function serveAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end()
    return
  }
  const pathname = pathnameOf(req)
  if (!pathname.startsWith(ASSET_PREFIX)) {
    res.writeHead(404)
    res.end()
    return
  }
  let relative
  try {
    relative = decodeURIComponent(pathname.slice(ASSET_PREFIX.length))
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  const normalized = normalize(relative)
  if (normalized.startsWith('..') || normalized.includes(`..${sep}`) || normalized.startsWith(sep)) {
    res.writeHead(404)
    res.end()
    return
  }
  const file = join(ASSET_ROOT, normalized)
  if (!file.startsWith(ASSET_ROOT)) {
    res.writeHead(404)
    res.end()
    return
  }
  let info
  try {
    info = await stat(file)
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  if (!info.isFile()) {
    res.writeHead(404)
    res.end()
    return
  }
  const extension = extname(file).toLowerCase()
  const headers = {
    'Content-Type': MIME[extension] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': extension === '.woff2' || extension === '.woff'
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
}

/**
 * Register the edit, preview, export, and static-asset HTTP surface.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {import('./service.js').ExcalidrawService} service shared business service
 */
export function applyRoutes(ctx, service) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/excalidraw-edit',
    handler: async (req, res) => {
      const pathname = pathnameOf(req)
      await withOwner(ctx, req, res, async () => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST is required' } })
        const body = await readBody(req)
        switch (pathname) {
          case '/api/excalidraw-edit/open':
            return sendOk(res, await service.openCanvas({
              sessionId: body.sessionId,
              path: body.path,
              token: body.token,
              signal: undefined,
            }))
          case '/api/excalidraw-edit/snapshot':
            return sendOk(res, await service.snapshot({
              sessionId: body.sessionId,
              token: body.token,
              path: body.path,
              signal: undefined,
            }))
          case '/api/excalidraw-edit/commit':
            return sendOk(res, await service.commit({
              sessionId: body.sessionId,
              token: body.token,
              path: body.path,
              baseVersion: body.baseVersion,
              opId: body.opId,
              elements: body.elements,
              files: body.files,
              appStatePatch: body.appStatePatch,
              document: body.document,
              flushId: body.flushId,
            }, undefined))
          case '/api/excalidraw-edit/poll':
            return sendOk(res, await service.pollAsync({
              sessionId: body.sessionId,
              token: body.token,
              path: body.path,
              knownVersion: body.knownVersion,
              dirty: body.dirty,
            }, undefined))
          case '/api/excalidraw-edit/ack':
            return sendOk(res, await service.ack({
              sessionId: body.sessionId,
              token: body.token,
              flushId: body.flushId,
              version: body.version,
              error: body.error,
            }))
          case '/api/excalidraw-edit/close':
            return sendOk(res, await service.close({ sessionId: body.sessionId, token: body.token }))
          default:
            return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown edit endpoint' } })
        }
      })
    },
  }), 'excalidraw: edit routes')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/excalidraw-preview',
    handler: async (req, res) => {
      const pathname = pathnameOf(req)
      await withOwner(ctx, req, res, async () => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST is required' } })
        const body = await readBody(req)
        if (pathname === '/api/excalidraw-preview/pending') {
          return sendOk(res, service.pendingPreview(body.sessionId) ?? null)
        }
        if (pathname === '/api/excalidraw-preview/opened') {
          service.markPreviewOpened(body.sessionId, body.token)
          return sendOk(res, { opened: true })
        }
        return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown preview endpoint' } })
      })
    },
  }), 'excalidraw: preview routes')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/excalidraw-export',
    handler: async (req, res) => {
      const pathname = pathnameOf(req)
      if (pathname === '/api/excalidraw-export/download') {
        try {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { Allow: 'GET, HEAD' })
            res.end()
            return
          }
          const token = queryOf(req).get('token') ?? ''
          const entry = service.getDownload(token)
          res.writeHead(200, {
            'Content-Type': entry.format === 'svg' ? 'image/svg+xml; charset=utf-8' : 'image/png',
            'Content-Length': entry.data.byteLength,
            'Content-Disposition': `attachment; filename="${entry.name.replace(/["\\]/g, '_')}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          })
          if (req.method === 'HEAD') res.end()
          else res.end(entry.data)
        } catch (error) {
          sendError(res, error)
        }
        return
      }
      await withOwner(ctx, req, res, async () => {
        if (pathname === '/api/excalidraw-export/source') {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET is required' } })
          const query = queryOf(req)
          return sendOk(res, await service.sourceExport({
            taskId: query.get('taskId') ?? '',
            sessionId: query.get('sessionId') ?? '',
            token: query.get('token') ?? '',
          }))
        }
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST is required' } })
        const body = await readBody(req)
        if (pathname === '/api/excalidraw-export/claim') {
          return sendOk(res, await service.claimExport({
            taskId: body.taskId,
            sessionId: body.sessionId,
            token: body.token,
            signal: undefined,
          }))
        }
        if (pathname === '/api/excalidraw-export/fail') {
          return sendOk(res, await service.failExport({
            taskId: body.taskId,
            sessionId: body.sessionId,
            token: body.token,
            message: body.message,
          }))
        }
        if (pathname === '/api/excalidraw-export/result') {
          return sendOk(res, await service.resultExport({
            taskId: body.taskId,
            sessionId: body.sessionId,
            token: body.token,
            version: body.version,
            format: body.format,
            data: body.data,
          }))
        }
        return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown export endpoint' } })
      })
    },
  }), 'excalidraw: export routes')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/excalidraw-assets',
    handler: async (req, res) => {
      try {
        await serveAsset(req, res)
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500)
          res.end(messageFor(error))
        }
      }
    },
  }), 'excalidraw: static assets')
}

export { ASSET_ROOT, readBody, sendJson }

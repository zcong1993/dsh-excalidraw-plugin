import { describe, expect, test } from 'bun:test'
import { ExcalidrawError } from '../src/host/document.js'
import { beginExport, fixtureDocument, pngBytes, setup } from './support/host-fixture.js'

async function openCanvas(document = fixtureDocument()) {
  const env = setup()
  await env.service.create(env.agent, 'a.excalidraw', document)
  const opened = await env.service.openCanvas({ sessionId: 's1', path: '/ws/a.excalidraw' })
  return { ...env, opened }
}

async function codeOf(promise) {
  try {
    await promise
    return undefined
  } catch (error) {
    return error instanceof ExcalidrawError ? error.code : error?.code
  }
}

function syncCodeOf(fn) {
  try {
    fn()
    return undefined
  } catch (error) {
    return error?.code
  }
}

function submit(env, task, { format = 'png', data }) {
  return env.service.resultExport({
    taskId: task.taskId,
    sessionId: 's1',
    token: task.token,
    version: task.claim.version,
    format,
    data,
  })
}

describe('export validation and delivery', () => {
  test('accepts a PNG within budget and keeps the download scoped to the version', async () => {
    const env = await openCanvas()
    const task = await beginExport(env.service, env.agent, { format: 'png' })
    const result = await submit(env, task, { data: pngBytes({ width: 10, height: 10 }).toString('base64') })

    expect(result).toMatchObject({
      path: '/ws/a.excalidraw',
      version: task.claim.version,
      format: 'png',
      bytes: 33,
    })
    expect(result.attachment).toMatchObject({ attachmentId: 'att-1', name: 'a.png', bytes: 33 })
    expect(result.downloadUrl).toContain('/api/excalidraw-export/download?token=')
    expect(env.attachments.saved[0].name).toBe('a.png')

    const settled = await task.settled
    expect(settled.ok).toBe(true)
    expect(env.service.exportTasks.size).toBe(0)

    const downloadToken = decodeURIComponent(new URL(result.downloadUrl, 'http://127.0.0.1').searchParams.get('token'))
    expect(env.service.getDownload(downloadToken).format).toBe('png')
  })

  test('rejects malformed PNG bytes and oversized dimensions', async () => {
    const cases = [
      ['missing signature', pngBytes({ signature: false }), 'INVALID_EXPORT'],
      ['zero width', pngBytes({ width: 0, height: 10 }), 'INVALID_EXPORT'],
      ['side too long', pngBytes({ width: 20_000, height: 10 }), 'EXPORT_TOO_LARGE'],
      ['too many pixels', pngBytes({ width: 5_000, height: 4_000 }), 'EXPORT_TOO_LARGE'],
      ['one byte', Buffer.from([0x89]), 'INVALID_EXPORT'],
    ]
    for (const [name, bytes, code] of cases) {
      const env = await openCanvas()
      const task = await beginExport(env.service, env.agent, { format: 'png' })
      expect([name, await codeOf(submit(env, task, { data: bytes.toString('base64') }))]).toEqual([name, code])
      expect(env.attachments.saved).toHaveLength(0)
      expect(env.service.exportTasks.has(task.taskId)).toBe(true)
      await env.service.failExport({ taskId: task.taskId, sessionId: 's1', token: task.token, message: 'cleanup' })
      const settled = await task.settled
      expect(settled.ok).toBe(false)
    }
  })

  test('rejects results for the wrong version, format, or empty payload', async () => {
    const env = await openCanvas()
    const task = await beginExport(env.service, env.agent, { format: 'png' })

    const wrongVersion = await codeOf(env.service.resultExport({
      taskId: task.taskId,
      sessionId: 's1',
      token: task.token,
      version: 'v999',
      format: 'png',
      data: pngBytes().toString('base64'),
    }))
    expect(wrongVersion).toBe('EXPORT_VERSION_CONFLICT')

    expect(await codeOf(submit(env, task, { format: 'svg', data: '<svg/>' }))).toBe('INVALID_EXPORT')
    expect(await codeOf(submit(env, task, { data: '' }))).toBe('INVALID_EXPORT')
    expect(await codeOf(submit(env, task, { data: 'AA==' }))).toBe('INVALID_EXPORT')
  })

  test('accepts an SVG with embedded fonts and local image data', async () => {
    const env = await openCanvas()
    const task = await beginExport(env.service, env.agent, { format: 'svg' })
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style>@font-face{src:url(data:font/woff2;base64,AA)}</style><image href="data:image/png;base64,AA"/><rect/></svg>'
    const result = await submit(env, task, { format: 'svg', data: Buffer.from(svg).toString('base64') })

    expect(result.format).toBe('svg')
    expect(env.service.getDownload(decodeURIComponent(new URL(result.downloadUrl, 'http://127.0.0.1').searchParams.get('token'))).format).toBe('svg')
    expect((await task.settled).ok).toBe(true)
  })

  test('rejects the unsafe SVG matrix without settling the task', async () => {
    const env = await openCanvas()
    const task = await beginExport(env.service, env.agent, { format: 'svg' })
    const cases = [
      ['script', '<svg><script>alert(1)</script></svg>', 'UNSAFE_EXPORT'],
      ['foreignObject', '<svg><foreignObject width="1"></foreignObject></svg>', 'UNSAFE_EXPORT'],
      ['iframe', '<svg><iframe src="https://evil.example"></iframe></svg>', 'UNSAFE_EXPORT'],
      ['object', '<svg><object data="x"></object></svg>', 'UNSAFE_EXPORT'],
      ['embed', '<svg><embed src="x"/></svg>', 'UNSAFE_EXPORT'],
      ['event handler', '<svg onload = "alert(1)"/>', 'UNSAFE_EXPORT'],
      ['javascript url', '<svg><a href="javascript:alert(1)">x</a></svg>', 'UNSAFE_EXPORT'],
      ['remote href', '<svg><image href="https://evil.example/x.png"/></svg>', 'UNSAFE_EXPORT'],
      ['protocol relative', '<svg><image href="//evil.example/x.png"/></svg>', 'UNSAFE_EXPORT'],
      ['remote xlink', '<svg><image xlink:href="https://evil.example/x"/></svg>', 'UNSAFE_EXPORT'],
      ['embedded svg data', '<svg><image href="data:image/svg+xml;base64,AA"/></svg>', 'UNSAFE_EXPORT'],
      ['remote stylesheet', '<svg><style>@import url("https://evil.example/x.css");</style></svg>', 'UNSAFE_EXPORT'],
      ['invalid utf8', Buffer.from([0xff, 0xfe]), 'INVALID_EXPORT'],
      ['not an svg root', '<html/>', 'INVALID_EXPORT'],
    ]
    for (const [name, body, code] of cases) {
      const data = Buffer.isBuffer(body) ? body.toString('base64') : Buffer.from(body).toString('base64')
      expect([name, await codeOf(submit(env, task, { format: 'svg', data }))]).toEqual([name, code])
    }
    expect(env.attachments.saved).toHaveLength(0)
    expect(env.service.exportTasks.has(task.taskId)).toBe(true)
    await env.service.failExport({ taskId: task.taskId, sessionId: 's1', token: task.token, message: 'unsafe' })
    expect((await task.settled).ok).toBe(false)
  })

  test('reports an attachment failure instead of a successful export', async () => {
    const env = await openCanvas()
    const task = await beginExport(env.service, env.agent, { format: 'png' })
    env.attachments.failNext = true
    expect(await codeOf(submit(env, task, { data: pngBytes().toString('base64') }))).toBe('ATTACHMENT_FAILED')
    expect(env.attachments.saved).toHaveLength(0)
    expect(env.service.downloads.size).toBe(0)
    expect(env.service.exportTasks.has(task.taskId)).toBe(true)
  })

  test('rejects unknown tasks, foreign sessions, and closed connections', async () => {
    const env = await openCanvas()
    const task = await beginExport(env.service, env.agent, { format: 'png' })

    expect(await codeOf(env.service.claimExport({ taskId: 'missing', sessionId: 's1', token: task.token })))
      .toBe('EXPORT_NOT_FOUND')
    expect(await codeOf(env.service.claimExport({ taskId: task.taskId, sessionId: 's2', token: task.token })))
      .toBe('UNAUTHORIZED')

    await env.service.close({ sessionId: 's1', token: task.token })
    expect(await codeOf(env.service.claimExport({ taskId: task.taskId, sessionId: 's1', token: task.token })))
      .toBe('NOT_OPEN')
  })

  test('rejects expired export tasks before rendering', async () => {
    const env = await openCanvas()
    const task = await beginExport(env.service, env.agent, { format: 'png' })
    const entry = env.service.exportTasks.get(task.taskId)
    entry.deadlineAt = 0
    expect(await codeOf(env.service.claimExport({ taskId: task.taskId, sessionId: 's1', token: task.token })))
      .toBe('EXPORT_EXPIRED')
  })

  test('expires download tokens after sixty seconds', async () => {
    const env = await openCanvas()
    const task = await beginExport(env.service, env.agent, { format: 'png' })
    const result = await submit(env, task, { data: pngBytes().toString('base64') })
    const downloadToken = decodeURIComponent(new URL(result.downloadUrl, 'http://127.0.0.1').searchParams.get('token'))

    const entry = env.service.downloads.get(downloadToken)
    entry.expiresAt = 0
    expect(syncCodeOf(() => env.service.getDownload(downloadToken))).toBe('DOWNLOAD_EXPIRED')
    expect(syncCodeOf(() => env.service.getDownload('unknown'))).toBe('DOWNLOAD_EXPIRED')
  })

  test('validates export arguments before reading the file', async () => {
    const env = await openCanvas()
    const invalid = [
      { path: 'a.excalidraw', format: 'pdf' },
      { path: 'a.excalidraw', scale: 0 },
      { path: 'a.excalidraw', scale: 4 },
      { path: 'a.excalidraw', scale: 1.5 },
      { path: 'a.excalidraw', transparent: 'yes' },
      { format: 'png' },
    ]
    for (const args of invalid) {
      expect(await codeOf(env.service.exportScene(env.agent, args))).toBe('INVALID_ARGUMENT')
    }
  })

  test('refuses an empty scene and a missing page', async () => {
    const empty = setup()
    const blank = { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }
    await empty.service.create(empty.agent, 'blank.excalidraw', blank)
    expect(await codeOf(empty.service.exportScene(empty.agent, { path: 'blank.excalidraw' }))).toBe('EMPTY_SCENE')

    const env = await openCanvas()
    await env.service.close({ sessionId: 's1', token: env.opened.token })
    expect(await codeOf(env.service.exportScene(env.agent, { path: 'a.excalidraw' }))).toBe('NO_PAGE')
  })
})

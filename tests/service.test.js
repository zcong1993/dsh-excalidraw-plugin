import { describe, expect, test } from 'bun:test'
import { ExcalidrawService } from '../src/host/service.js'

function fixtureDocument() {
  return {
    type: 'excalidraw',
    version: 2,
    elements: [{
      id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, angle: 0,
      strokeColor: '#000', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1,
      strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], boundElements: [],
      isDeleted: false, link: null, locked: false,
    }],
    appState: { viewBackgroundColor: '#fff', futureField: 7 },
    files: {},
    futureTopLevel: { keep: true },
  }
}

class FakeFs {
  constructor() {
    this.files = new Map()
    this.nextVersion = 1
  }
  async resolve(path, { cwd } = {}) {
    const absolute = path.startsWith('/') ? path : `${cwd ?? '/ws'}/${path.replace(/^\.\//, '')}`
    return { targetKey: absolute, displayPath: absolute }
  }
  processPath(target) { return target.targetKey }
  async lstat(path, { cwd } = {}) {
    const target = await this.resolve(path, { cwd })
    const entry = this.files.get(target.targetKey)
    if (entry === undefined) return undefined
    return { type: 'file', version: `v${entry.version}`, size: entry.content.length }
  }
  async stat(target) {
    const entry = this.files.get(target.targetKey)
    if (entry === undefined) return undefined
    return { type: 'file', version: `v${entry.version}`, size: entry.content.length }
  }
  async readText(target) {
    const entry = this.files.get(target.targetKey)
    if (entry === undefined) throw Object.assign(new Error('not found'), { code: 'FS_NOT_FOUND' })
    return entry.content
  }
  async writeText(target, content, intent) {
    const entry = this.files.get(target.targetKey)
    if (intent?.kind === 'createIfAbsent' && entry !== undefined) {
      throw Object.assign(new Error('exists'), { code: 'FS_EXISTS' })
    }
    if (intent?.kind === 'replaceIfVersion' && (entry === undefined || `v${entry.version}` !== intent.version)) {
      throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    }
    const version = this.nextVersion++
    this.files.set(target.targetKey, { content, version })
    return { operation: entry === undefined ? 'create' : 'update', version: `v${version}`, before: entry?.content ?? null, after: content }
  }
  /** Test-only external write that advances the file version. */
  externalWrite(path, content) {
    const version = this.nextVersion++
    this.files.set(path, { content, version })
    return `v${version}`
  }
}

function fakeContext(fs) {
  const agent = { id: 's1', session: { id: 's1' }, status: 'idle' }
  const attachments = {
    saved: [],
    async saveFile(input) {
      this.saved.push(input)
      return { attachmentId: `att-${this.saved.length}`, name: input.name ?? 'file', bytes: input.data.byteLength }
    },
  }
  return {
    agent,
    attachments,
    fs,
    ctx: {
      get(name) {
        if (name === 'fs') return fs
        if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/ws' }) }
        if (name === 'workingDirectory') return { ensure: async () => '/ws' }
        if (name === 'agents') return { get: (id) => (id === 's1' ? agent : undefined) }
        if (name === 'attachments') return attachments
        return undefined
      },
      emit() {},
    },
  }
}

function setup() {
  const fs = new FakeFs()
  const { ctx, agent, attachments } = fakeContext(fs)
  const service = new ExcalidrawService(ctx, { warn() {} })
  return { fs, ctx, agent, attachments, service }
}

async function waitForExportTask(service) {
  for (let index = 0; index < 100; index += 1) {
    if (service.exportTasks.size > 0) return [...service.exportTasks.keys()][0]
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('export task was not created')
}

describe('host scene service', () => {
  test('create refuses an existing path and preserves raw bytes', async () => {
    const { service, agent, fs } = setup()
    const created = await service.create(agent, 'a.excalidraw', fixtureDocument())
    expect(created.created).toBe(true)
    expect(created.version).toBe('v1')
    expect(fs.files.get('/ws/a.excalidraw').content.endsWith('\n')).toBe(true)
    await expect(service.create(agent, 'a.excalidraw', fixtureDocument())).rejects.toThrow(/already exists/)
  })

  test('read summary cannot be mixed with document mode', async () => {
    const { service, agent } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const summary = await service.read(agent, { path: 'a.excalidraw' })
    expect(summary.format).toBe('summary')
    expect(summary.elements[0].id).toBe('r1')
    await expect(service.read(agent, { path: 'a.excalidraw', format: 'document', limit: 2 })).rejects.toThrow(/cannot be combined/)
  })

  test('update rejects a stale expectedVersion without writing', async () => {
    const { service, agent, fs } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const begun = await service.begin(agent, { path: 'a.excalidraw' })
    fs.externalWrite('/ws/a.excalidraw', JSON.stringify(fixtureDocument()))
    await expect(service.update(agent, {
      transactionId: begun.transactionId,
      expectedVersion: begun.version,
      updates: [{ id: 'r1', patch: { x: 55 } }],
    })).rejects.toThrow(/changed since the locked baseline/)
    expect(service.transactions.size).toBe(0)
  })

  test('a second transaction on the same source is refused', async () => {
    const { service, agent } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const first = await service.begin(agent, { path: 'a.excalidraw' })
    await expect(service.begin(agent, { path: 'a.excalidraw' })).rejects.toThrow(/transaction already holds/)
    await service.end(agent, first.transactionId)
    await expect(service.begin(agent, { path: 'a.excalidraw' })).resolves.toBeTruthy()
  })

  test('patch update soft-deletes and preserves unknown fields', async () => {
    const { service, agent } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const begun = await service.begin(agent, { path: 'a.excalidraw' })
    const updated = await service.update(agent, {
      transactionId: begun.transactionId,
      expectedVersion: begun.version,
      updates: [{ id: 'r1', patch: { x: 40, isDeleted: true } }],
    })
    expect(updated.ended).toBe(true)
    const document = await service.read(agent, { path: 'a.excalidraw', format: 'document' })
    expect(document.document.elements[0].isDeleted).toBe(true)
    expect(document.document.futureTopLevel.keep).toBe(true)
    expect(document.document.appState.futureField).toBe(7)
  })

  test('working lock rejects a normal commit and flush commit succeeds', async () => {
    const { service, agent, fs } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const opened = await service.openCanvas({ sessionId: 's1', path: '/ws/a.excalidraw' })
    service.setWorking('s1', true)
    await expect(service.commit({
      sessionId: 's1',
      token: opened.token,
      baseVersion: opened.version,
      opId: 'locked-1',
      elements: [{ ...fixtureDocument().elements[0], x: 9 }],
      files: {},
      appStatePatch: {},
    })).rejects.toThrow(/Agent is working/)

    const flushPromise = service.flushSession('s1', 'agent-start', undefined, { force: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const conn = service.connections.get(opened.token)
    const flushId = conn.flush.id
    const committed = await service.commit({
      sessionId: 's1',
      token: opened.token,
      baseVersion: opened.version,
      opId: 'flush-1',
      elements: [{ ...fixtureDocument().elements[0], x: 12 }],
      files: {},
      appStatePatch: {},
      flushId,
    })
    expect(committed.version).not.toBe(opened.version)
    expect(await flushPromise).toBe(committed.version)
    expect(fs.files.get('/ws/a.excalidraw').content).toContain('"x": 12')
  })

  test('idempotent retry returns the first version for one op id', async () => {
    const { service, agent } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const opened = await service.openCanvas({ sessionId: 's1', path: '/ws/a.excalidraw' })
    const input = {
      sessionId: 's1',
      token: opened.token,
      baseVersion: opened.version,
      opId: 'same-op',
      elements: [{ ...fixtureDocument().elements[0], x: 33 }],
      files: {},
      appStatePatch: {},
    }
    const first = await service.commit(input)
    const second = await service.commit(input)
    expect(second.version).toBe(first.version)
  })

  test('external change surfaces as a conflict and snapshot adopts it', async () => {
    const { service, agent, fs } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const opened = await service.openCanvas({ sessionId: 's1', path: '/ws/a.excalidraw' })
    service.connections.get(opened.token).dirty = true
    const external = fixtureDocument()
    external.elements[0].x = 77
    fs.externalWrite('/ws/a.excalidraw', `${JSON.stringify(external)}\n`)
    const polled = await service.pollAsync({ sessionId: 's1', token: opened.token, dirty: true })
    expect(polled.externalChange).toBe(true)
    expect(polled.version).not.toBe(opened.version)
    const snapshot = await service.snapshot({ sessionId: 's1', token: opened.token })
    expect(snapshot.document.elements[0].x).toBe(77)
  })

  test('preview pending request is consumed by openCanvas', async () => {
    const { service, agent } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const preview = await service.preview(agent, 'a.excalidraw')
    const pending = service.pendingPreview('s1')
    expect(pending.path).toBe(preview.path)
    const opened = await service.openCanvas({ sessionId: 's1', path: pending.path, token: pending.token })
    expect(opened.version).toBe(preview.version)
    expect(service.pendingPreview('s1')).toBeUndefined()
  })

  test('export task flushes, claims, validates PNG, and saves an attachment', async () => {
    const { service, agent, attachments } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const opened = await service.openCanvas({ sessionId: 's1', path: '/ws/a.excalidraw' })
    const exportPromise = service.exportScene(agent, { path: 'a.excalidraw', format: 'png', scale: 2 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const conn = service.connections.get(opened.token)
    if (conn.flush !== null) await service.ack({ sessionId: 's1', token: opened.token, flushId: conn.flush.id })
    const taskId = await waitForExportTask(service)
    expect(taskId).toBeDefined()
    const claim = await service.claimExport({ taskId, sessionId: 's1', token: opened.token })
    expect(claim.version).toBeTruthy()
    const png = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0)
    png.writeUInt32BE(10, 16)
    png.writeUInt32BE(10, 20)
    const result = await service.resultExport({
      taskId,
      sessionId: 's1',
      token: opened.token,
      version: claim.version,
      format: 'png',
      data: png.toString('base64'),
    })
    expect(result.attachment.attachmentId).toBe('att-1')
    expect(result.downloadUrl).toContain('/api/excalidraw-export/download?token=')
    expect(attachments.saved[0].data.byteLength).toBe(33)
    await expect(exportPromise).resolves.toMatchObject({ format: 'png', version: claim.version })
  })

  test('unsafe SVG export is rejected', async () => {
    const { service, agent, attachments } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const opened = await service.openCanvas({ sessionId: 's1', path: '/ws/a.excalidraw' })
    const exportPromise = service.exportScene(agent, { path: 'a.excalidraw', format: 'svg' }).catch((error) => error)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const conn = service.connections.get(opened.token)
    if (conn.flush !== null) await service.ack({ sessionId: 's1', token: opened.token, flushId: conn.flush.id })
    const taskId = await waitForExportTask(service)
    const claim = await service.claimExport({ taskId, sessionId: 's1', token: opened.token })
    const unsafe = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    await expect(service.resultExport({
      taskId,
      sessionId: 's1',
      token: opened.token,
      version: claim.version,
      format: 'svg',
      data: Buffer.from(unsafe).toString('base64'),
    })).rejects.toThrow(/script element/)
    expect(attachments.saved.length).toBe(0)
    await service.failExport({ taskId, sessionId: 's1', token: opened.token, message: 'unsafe' })
    const error = await exportPromise
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/unsafe/)
  })

  test('dispose rejects a pending export and clears pending transactions', async () => {
    const { service, agent } = setup()
    await service.create(agent, 'a.excalidraw', fixtureDocument())
    const begun = await service.begin(agent, { path: 'a.excalidraw' })
    const opened = await service.openCanvas({ sessionId: 's1', path: '/ws/a.excalidraw' })
    const exportPromise = service.exportScene(agent, { path: 'a.excalidraw', format: 'png' }).catch((error) => error)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const conn = service.connections.get(opened.token)
    if (conn.flush !== null) await service.ack({ sessionId: 's1', token: opened.token, flushId: conn.flush.id })
    await waitForExportTask(service)
    service.dispose()
    expect(service.transactions.size).toBe(0)
    const error = await exportPromise
    expect(error).toBeInstanceOf(Error)
    expect(begun.transactionId).toBeTruthy()
  })
})

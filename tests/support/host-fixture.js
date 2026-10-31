/** Shared fake Host fixtures for the service, export, routes, and tools tests. */

import { ExcalidrawService } from '../../src/host/service.js'

export function fixtureDocument() {
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

export class FakeFs {
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

export function fakeAttachments() {
  return {
    saved: [],
    failNext: false,
    async saveFile(input) {
      if (this.failNext) throw new Error('attachment store is offline')
      this.saved.push(input)
      return { attachmentId: `att-${this.saved.length}`, name: input.name ?? 'file', bytes: input.data.byteLength }
    },
  }
}

export function fakeContext(fs, { attachments = fakeAttachments() } = {}) {
  const agent = { id: 's1', session: { id: 's1' }, status: 'idle' }
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

export function setup() {
  const fs = new FakeFs()
  const { ctx, agent, attachments } = fakeContext(fs)
  const service = new ExcalidrawService(ctx, { warn() {} })
  return { fs, ctx, agent, attachments, service }
}

export async function waitForExportTask(service) {
  for (let index = 0; index < 100; index += 1) {
    if (service.exportTasks.size > 0) return [...service.exportTasks.keys()][0]
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('export task was not created')
}

/** A minimal PNG header accepted by the Host byte validator. */
export function pngBytes({ width = 10, height = 10, signature = true } = {}) {
  const bytes = Buffer.alloc(33)
  if (signature) Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

/**
 * Start an export on an already-open canvas, complete the flush handshake, and
 * return the claim. `settled` never rejects, so error-path assertions can await
 * it without racing an unhandled rejection.
 */
export async function beginExport(service, agent, { path = 'a.excalidraw', format = 'png', scale = 2, transparent } = {}) {
  const conn = [...service.connections.values()].find((candidate) => candidate.open)
  if (conn === undefined) throw new Error('beginExport requires an open canvas')
  const settled = service.exportScene(agent, {
    path,
    format,
    scale,
    ...(transparent === undefined ? {} : { transparent }),
  }).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (conn.flush !== null) {
    await service.ack({ sessionId: conn.sessionId, token: conn.token, flushId: conn.flush.id })
  }
  const taskId = await waitForExportTask(service)
  const claim = await service.claimExport({ taskId, sessionId: conn.sessionId, token: conn.token })
  return { settled, taskId, claim, token: conn.token, sessionId: conn.sessionId }
}

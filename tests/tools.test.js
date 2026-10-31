import { describe, expect, test } from 'bun:test'
import { applySceneTools } from '../src/host/tools.js'

function captureTools(service) {
  const tools = []
  const ctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
  }
  applySceneTools(ctx, service)
  return tools
}

function fakeService() {
  const calls = []
  const record = (name) => async (...args) => {
    calls.push([name, ...args])
    if (name === 'preview') return { path: args[1], version: 'v1', sessionId: 's1', opened: true }
    if (name === 'exportScene') {
      return {
        path: args[1].path,
        version: 'v1',
        format: args[1].format ?? 'png',
        bytes: 42,
        downloadUrl: '/api/excalidraw-export/download?token=t',
        attachment: { attachmentId: 'att-1', name: 'a.png', bytes: 42 },
      }
    }
    return { path: args[1], version: 'v1', created: name === 'create' }
  }
  return {
    calls,
    service: {
      create: record('create'),
      read: record('read'),
      begin: record('begin'),
      update: record('update'),
      end: record('end'),
      preview: record('preview'),
      exportScene: record('exportScene'),
    },
  }
}

function findUndefined(value, path = '$', found = []) {
  if (value === undefined) {
    found.push(path)
    return found
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findUndefined(item, `${path}[${index}]`, found))
    return found
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) findUndefined(item, `${path}.${key}`, found)
  }
  return found
}

function scene(overrides = {}) {
  return {
    path: 'a.excalidraw',
    version: 'v1',
    format: 'summary',
    returned: 1,
    total: 1,
    truncated: false,
    filesCount: 0,
    elements: [{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, isDeleted: false }],
    ...overrides,
  }
}

describe('model-facing tools', () => {
  test('registers the scene, preview, and export tools', () => {
    const { service } = fakeService()
    const tools = captureTools(service)
    expect(tools.map((tool) => tool.name)).toEqual([
      'excalidraw_scene', 'excalidraw_preview', 'excalidraw_export',
    ])
    expect(tools[2].timeoutMs).toBe(75_000)
  })

  test('keeps tool parameters closed and their enums complete', () => {
    const { service } = fakeService()
    const [sceneTool, previewTool, exportTool] = captureTools(service)

    for (const tool of [sceneTool, previewTool, exportTool]) {
      expect(tool.parameters.type).toBe('object')
      expect(tool.parameters.additionalProperties).toBe(false)
      expect(Array.isArray(tool.parameters.required)).toBe(true)
      expect(tool.output.schema.type).toBe('object')
      expect(tool.output.schema.additionalProperties).toBe(true)
      expect(typeof tool.description).toBe('string')
    }

    expect(sceneTool.parameters.required).toEqual(['action'])
    expect(sceneTool.parameters.properties.action.enum).toEqual(['create', 'read', 'begin', 'update', 'end'])
    expect(sceneTool.parameters.properties.format.enum).toEqual(['summary', 'document'])
    expect(sceneTool.parameters.properties.updates.items.properties.patch.type).toBe('object')
    expect(sceneTool.parameters.properties.limit.type).toBe('integer')
    expect(previewTool.parameters.required).toEqual(['path'])
    expect(exportTool.parameters.required).toEqual(['path'])
    expect(exportTool.parameters.properties.format.enum).toEqual(['png', 'svg'])
    expect(exportTool.parameters.properties.scale.type).toBe('integer')
  })

  test('presentationMeta never contains undefined', () => {
    const { service } = fakeService()
    const [sceneTool, previewTool, exportTool] = captureTools(service)

    const metas = [
      sceneTool.output.presentationMeta({}, {}),
      sceneTool.output.presentationMeta({}, { path: 'a.excalidraw', version: 'v1' }),
      previewTool.output.presentationMeta({}, { path: 'a.excalidraw', version: 'v1' }),
      exportTool.output.presentationMeta({}, {}),
      exportTool.output.presentationMeta({}, { path: 'a.excalidraw', version: 'v1', format: 'svg' }),
    ]
    for (const meta of metas) expect(findUndefined(meta)).toEqual([])
    expect(metas[1]).toEqual({ path: 'a.excalidraw', version: 'v1' })
    expect(metas[4]).toEqual({ path: 'a.excalidraw', version: 'v1', format: 'svg' })
  })

  test('renders scene summaries, raw documents, and ended transactions', () => {
    const { service } = fakeService()
    const [sceneTool] = captureTools(service)

    const summary = sceneTool.output.render({}, scene())
    expect(summary).toHaveLength(1)
    expect(summary[0].text).toContain('a.excalidraw (version v1)')
    expect(summary[0].text).toContain('1 of 1 elements shown')
    expect(summary[0].text).toContain('rectangle r1')

    const raw = sceneTool.output.render({}, scene({ format: 'document', document: { type: 'excalidraw' } }))
    expect(raw[0].text).toContain('"type": "excalidraw"')

    const ended = sceneTool.output.render({}, { ended: true, transactionId: 't1' })
    expect(ended[0].text).toContain('transaction t1 ended')
    expect(ended[0].text).toContain('not changed')

    expect(sceneTool.output.render({}, null)[0].text).toBe('null')
  })

  test('renders preview and export results', () => {
    const { service } = fakeService()
    const [, previewTool, exportTool] = captureTools(service)

    const preview = previewTool.output.render({}, { path: 'a.excalidraw', version: 'v1' })
    expect(preview[0].text).toContain('Opened a.excalidraw')

    const blocks = exportTool.output.render({}, {
      path: 'a.excalidraw',
      version: 'v1',
      format: 'svg',
      bytes: 12,
      downloadUrl: '/download?token=t',
      attachment: { attachmentId: 'att-1' },
    })
    expect(blocks[0].text).toContain('SVG at source version v1')
    expect(blocks[0].text).toContain('valid for 60 seconds')
    expect(blocks[1]).toEqual({ type: 'file', attachment: { attachmentId: 'att-1' } })
  })

  test('dispatches scene actions to the service', async () => {
    const { service, calls } = fakeService()
    const [sceneTool] = captureTools(service)
    const agent = { id: 's1' }
    const signal = new AbortController().signal
    const document = { type: 'excalidraw', version: 2, elements: [] }

    await sceneTool.execute({ action: 'create', path: 'a.excalidraw', document }, { agent, signal })
    await sceneTool.execute({ action: 'read', path: 'a.excalidraw' }, { agent, signal })
    await sceneTool.execute({ action: 'begin', path: 'a.excalidraw' }, { agent, signal })
    await sceneTool.execute({ action: 'update', transactionId: 't1', expectedVersion: 'v1' }, { agent, signal })
    await sceneTool.execute({ action: 'end', transactionId: 't1' }, { agent, signal })

    expect(calls.map((call) => call[0])).toEqual(['create', 'read', 'begin', 'update', 'end'])
    expect(calls[0][1]).toBe(agent)
    expect(calls[0][2]).toBe('a.excalidraw')
    expect(calls[0][3]).toBe(document)
    expect(calls[4][2]).toBe('t1')
  })

  test('rejects incomplete scene requests with actionable codes', async () => {
    const { service } = fakeService()
    const [sceneTool] = captureTools(service)
    const exec = { agent: { id: 's1' }, signal: undefined }

    await expect(sceneTool.execute({ action: 'create' }, exec)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT', message: 'create requires path',
    })
    await expect(sceneTool.execute({ action: 'create', path: 'a.excalidraw' }, exec)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT', message: 'create requires a complete document',
    })
    await expect(sceneTool.execute({ action: 'explode' }, exec)).rejects.toMatchObject({
      code: 'INVALID_ACTION',
    })
    await expect(sceneTool.execute({ action: 'read', path: 'a.excalidraw' }, { agent: undefined })).rejects.toMatchObject({
      code: 'SESSION_REQUIRED',
    })
  })

  test('requires a session for preview and export', async () => {
    const { service, calls } = fakeService()
    const [, previewTool, exportTool] = captureTools(service)
    await expect(previewTool.execute({ path: 'a.excalidraw' }, { agent: undefined })).rejects.toMatchObject({
      code: 'SESSION_REQUIRED',
    })
    await expect(exportTool.execute({ path: 'a.excalidraw' }, { agent: undefined })).rejects.toMatchObject({
      code: 'SESSION_REQUIRED',
    })
    expect(calls).toHaveLength(0)
  })

  test('dispatches preview and export with the caller signal', async () => {
    const { service, calls } = fakeService()
    const [, previewTool, exportTool] = captureTools(service)
    const agent = { id: 's1' }
    const signal = new AbortController().signal

    await previewTool.execute({ path: 'a.excalidraw' }, { agent, signal })
    await exportTool.execute({ path: 'a.excalidraw', format: 'svg' }, { agent, signal })

    expect(calls[0]).toEqual(['preview', agent, 'a.excalidraw', signal])
    expect(calls[1]).toEqual(['exportScene', agent, { path: 'a.excalidraw', format: 'svg' }, signal])
  })

  test('presents calls and results without undefined fields', () => {
    const { service } = fakeService()
    const [sceneTool, previewTool, exportTool] = captureTools(service)

    expect(sceneTool.presentCall({ action: 'read', path: 'a.excalidraw' })).toEqual({
      card: 'generic',
      title: 'Excalidraw read',
      kind: 'other',
      locations: [{ path: 'a.excalidraw' }],
    })
    expect(sceneTool.presentCall({ action: 'end' })).toEqual({
      card: 'generic',
      title: 'Excalidraw end',
      kind: 'other',
    })
    expect(previewTool.presentCall({ path: 'a.excalidraw' })).toMatchObject({
      title: 'Open a.excalidraw',
      kind: 'read',
    })
    expect(exportTool.presentCall({ path: 'a.excalidraw' })).toMatchObject({
      title: 'Export png a.excalidraw',
      kind: 'other',
    })
    expect(exportTool.presentResult({ path: 'a.excalidraw' }, { isError: true })).toBeUndefined()
    expect(exportTool.presentResult({ path: 'a.excalidraw' }, {})).toEqual({
      card: 'generic',
      title: 'Exported a.excalidraw',
    })
    expect(findUndefined(sceneTool.presentCall({ path: 'a.excalidraw', action: 'read' }))).toEqual([])
    expect(findUndefined(previewTool.presentCall({ path: 'a.excalidraw' }))).toEqual([])
    expect(findUndefined(exportTool.presentCall({ path: 'a.excalidraw' }))).toEqual([])
    expect(findUndefined(exportTool.presentResult({ path: 'a.excalidraw' }, {}))).toEqual([])
  })
})

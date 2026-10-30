import { ExcalidrawError, LIMITS } from './document.js'

function textBlock(text) {
  return { type: 'text', text }
}

function renderJson(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function describeScene(value) {
  if (typeof value !== 'object' || value === null) return renderJson(value)
  if (value.ended === true && (value.path === undefined || value.path === null)) {
    return [{ type: 'text', text: `Excalidraw transaction ${value.transactionId ?? '(unknown)'} ended; the source file was not changed.` }]
  }
  if (value.format === 'document' && value.document !== undefined) {
    return [{ type: 'text', text: `Excalidraw source ${value.path} (version ${value.version})\n\n${JSON.stringify(value.document, null, 2)}` }]
  }
  const lines = [
    `Excalidraw source ${value.path} (version ${value.version})`,
    `${value.returned ?? 0} of ${value.total ?? 0} elements shown${value.truncated ? `; nextOffset=${value.nextOffset}` : ''}`,
    `files=${value.filesCount ?? 0}`,
  ]
  for (const element of value.elements ?? []) {
    const text = element.text === undefined ? '' : ` text=${JSON.stringify(element.text)}`
    lines.push(`- ${element.type} ${element.id} at (${element.x}, ${element.y}) size ${element.width}x${element.height}${text}${element.isDeleted ? ' [deleted]' : ''}`)
  }
  if (value.transactionId !== undefined) lines.push(`transactionId=${value.transactionId}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

const SCENE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'read', 'begin', 'update', 'end'],
      description: 'Operation to perform. create writes a new source; read returns a bounded summary or the raw document; begin/update/end implement a versioned locked transaction.',
    },
    path: {
      type: 'string',
      description: 'Path to the .excalidraw source, resolved relative to the calling Session working directory. Required by create, read (by path), begin.',
    },
    document: {
      type: 'object',
      additionalProperties: true,
      description: 'Complete raw {type:"excalidraw",version:2,elements,appState?,files?} document. Required by create. On update it replaces the whole document and removes omitted content.',
    },
    transactionId: {
      type: 'string',
      description: 'Transaction id returned by begin. Required by update and end; read may use it to read the locked baseline.',
    },
    expectedVersion: {
      type: 'string',
      description: 'Version returned by begin. update fails with VERSION_CONFLICT when the file no longer matches this baseline.',
    },
    updates: {
      type: 'array',
      description: '1-200 shallow element patches. New element ids need type and complete geometry; patch.id is forbidden. Use {id, patch:{isDeleted:true}} for soft deletion.',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string', description: 'Existing or new element id.' },
          patch: { type: 'object', additionalProperties: true, description: 'Fields to shallow-merge into the element.' },
        },
      },
    },
    format: {
      type: 'string',
      enum: ['summary', 'document'],
      description: 'summary (default) returns a bounded element page; document returns the complete raw JSON and cannot be combined with ids/offset/limit.',
    },
    ids: {
      type: 'array',
      description: 'At most 200 element ids to include in a summary.',
      items: { type: 'string' },
    },
    offset: {
      type: 'integer',
      description: 'Zero-based offset into the selected elements. Default 0.',
    },
    limit: {
      type: 'integer',
      description: `Summary page size from 1 to ${LIMITS.maxPage}. Default ${LIMITS.defaultPage}.`,
    },
  },
}

const SCENE_OUTPUT = {
  type: 'object',
  additionalProperties: true,
  properties: {
    path: { type: 'string' },
    version: { type: 'string' },
    transactionId: { type: 'string' },
    created: { type: 'boolean' },
  },
}

const PREVIEW_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      description: 'Path to an existing .excalidraw source, resolved relative to the calling Session working directory.',
    },
  },
}

const PREVIEW_OUTPUT = {
  type: 'object',
  additionalProperties: true,
  properties: {
    path: { type: 'string' },
    version: { type: 'string' },
    sessionId: { type: 'string' },
    opened: { type: 'boolean' },
  },
}

const EXPORT_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      description: 'Path to the .excalidraw source to export, resolved relative to the calling Session working directory.',
    },
    format: {
      type: 'string',
      enum: ['png', 'svg'],
      description: 'Export format; defaults to png.',
    },
    scale: {
      type: 'integer',
      description: 'PNG scale (1, 2, or 3); defaults to 2. SVG ignores it.',
    },
    transparent: {
      type: 'boolean',
      description: 'Whether the export background is transparent; defaults to false.',
    },
  },
}

const EXPORT_OUTPUT = {
  type: 'object',
  additionalProperties: true,
  properties: {
    path: { type: 'string' },
    version: { type: 'string' },
    format: { type: 'string' },
    downloadUrl: { type: 'string' },
    attachment: { type: 'object', additionalProperties: true },
  },
}

/**
 * Register the three model-facing Excalidraw tools.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {import('./service.js').ExcalidrawService} service shared business service
 */
export function applySceneTools(ctx, service) {
  const sceneTool = {
    name: 'excalidraw_scene',
    description: [
      'Create, read, and version-lock-modify a standard .excalidraw source file.',
      'Use action=create with a complete document and a path that must not exist; create never overwrites a file, directory, or symlink.',
      'Use action=read (path or transactionId) to get a bounded element summary (default) or the complete raw document.',
      'Use begin -> update -> end for a versioned transaction. begin flushes any connected canvas draft and locks a source snapshot; update needs expectedVersion and exactly one of updates/document; end abandons an uncommitted transaction.',
      'The caller supplies layout, coordinates, text measurement, bindings, and frame relationships. This tool executes and validates; it does not auto-layout.',
      'Path is relative to the calling Session working directory and must end in .excalidraw. Never print raw JSON to the user; keep element ids stable.',
    ].join(' '),
    parameters: SCENE_PARAMETERS,
    output: {
      schema: SCENE_OUTPUT,
      render: (_args, value) => describeScene(value),
      presentationMeta: (_args, value) => ({
        ...(typeof value.path === 'string' ? { path: value.path } : {}),
        ...(typeof value.version === 'string' ? { version: value.version } : {}),
      }),
    },
    async execute(args, exec) {
      const signal = exec.signal
      const agent = exec.agent
      if (agent === undefined) throw new ExcalidrawError('SESSION_REQUIRED', 'Excalidraw tools require a Session-scoped Agent')
      const action = args.action
      if (action === 'create') {
        if (typeof args.path !== 'string') throw new ExcalidrawError('INVALID_ARGUMENT', 'create requires path')
        if (args.document === undefined) throw new ExcalidrawError('INVALID_ARGUMENT', 'create requires a complete document')
        return service.create(agent, args.path, args.document, signal)
      }
      if (action === 'read') return service.read(agent, args, signal)
      if (action === 'begin') return service.begin(agent, args, signal)
      if (action === 'update') return service.update(agent, args, signal)
      if (action === 'end') return service.end(agent, args.transactionId)
      throw new ExcalidrawError('INVALID_ACTION', 'action must be create, read, begin, update, or end')
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Excalidraw ${args.action}`,
        kind: 'other',
        ...(typeof args.path === 'string' ? { locations: [{ path: args.path }] } : {}),
      }
    },
  }

  const previewTool = {
    name: 'excalidraw_preview',
    description: [
      'Open an existing .excalidraw source in the current Session right sidebar.',
      'The canvas starts read-only. The user may click Edit while the Session is idle; user edits are autosaved to the same file.',
      'Call this after creating or changing a diagram so the user can see it. Do not reopen the canvas after every tool change; the open canvas follows source versions automatically.',
      'Only the foreground Session opens a page. If several diagrams could be meant, ask the user before choosing one.',
    ].join(' '),
    parameters: PREVIEW_PARAMETERS,
    output: {
      schema: PREVIEW_OUTPUT,
      render: (_args, value) => [{
        type: 'text',
        text: `Opened ${value.path} in the right sidebar (version ${value.version}). The canvas follows later source changes automatically.`,
      }],
      presentationMeta: (_args, value) => ({ path: value.path, version: value.version }),
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new ExcalidrawError('SESSION_REQUIRED', 'excalidraw_preview requires a Session-scoped Agent')
      return service.preview(exec.agent, args.path, exec.signal)
    },
    presentCall(args) {
      return { card: 'generic', title: `Open ${args.path}`, kind: 'read', locations: [{ path: args.path }] }
    },
  }

  const exportTool = {
    name: 'excalidraw_export',
    description: [
      'Export the whole committed diagram with the official Excalidraw renderer on the connected page.',
      'Supported formats are PNG (scale 1x/2x/3x, default 2x) and SVG (vector with embedded fonts). Set transparent=true for a transparent background.',
      'The export is the whole scene, not a screenshot of the viewport. The tool flushes the user draft and locks one source version first; the returned file attachment and download URL both name that version.',
      'Open the canvas with excalidraw_preview before exporting; without a connected page the export fails explicitly.',
    ].join(' '),
    parameters: EXPORT_PARAMETERS,
    output: {
      schema: EXPORT_OUTPUT,
      render: (_args, value) => {
        const blocks = [textBlock(
          `Exported ${value.path} as ${value.format.toUpperCase()} at source version ${value.version} (${value.bytes} bytes).\n`
          + `Download link (valid for 60 seconds): ${value.downloadUrl}\n`
          + `The file attachment below is the durable copy of the same bytes.`,
        )]
        if (value.attachment !== undefined) blocks.push({ type: 'file', attachment: value.attachment })
        return blocks
      },
      presentationMeta: (_args, value) => ({
        ...(typeof value.path === 'string' ? { path: value.path } : {}),
        ...(typeof value.version === 'string' ? { version: value.version } : {}),
        ...(typeof value.format === 'string' ? { format: value.format } : {}),
      }),
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new ExcalidrawError('SESSION_REQUIRED', 'excalidraw_export requires a Session-scoped Agent')
      return service.exportScene(exec.agent, args, exec.signal)
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Export ${args.format ?? 'png'} ${args.path}`,
        kind: 'other',
        locations: [{ path: args.path }],
      }
    },
    presentResult(args, result) {
      if (result.isError) return undefined
      return { card: 'generic', title: `Exported ${args.path}` }
    },
    timeoutMs: 75_000,
  }

  ctx.effect(() => ctx.tools.register(sceneTool), 'excalidraw: scene tool')
  ctx.effect(() => ctx.tools.register(previewTool), 'excalidraw: preview tool')
  ctx.effect(() => ctx.tools.register(exportTool), 'excalidraw: export tool')


}

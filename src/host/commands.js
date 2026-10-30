/**
 * Register the low-level diagnostic commands. The natural-language drawing
 * workflow lives in the independent `excalidraw` skill.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {import('./service.js').ExcalidrawService} service shared business service
 */
export function applyCommands(ctx, service) {
  ctx.effect(() => ctx.commands.register({
    name: 'excalidraw-scene',
    description: 'Run one low-level excalidraw_scene operation from JSON (diagnostics and deterministic edits)',
    input: { hint: '<JSON: {"action":"read","path":"diagram.excalidraw"}>' },
    recordInput: true,
    async handler(invocation) {
      const raw = invocation.rawInput.trim()
      if (raw.length === 0) return { kind: 'error', text: 'Usage: /excalidraw-scene <JSON object>' }
      let payload
      try {
        payload = JSON.parse(raw)
      } catch (error) {
        return { kind: 'error', text: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
      }
      try {
        const value = await service.runSceneCommand(invocation.agent, payload, invocation.signal)
        return { kind: 'success', text: clip(JSON.stringify(value, null, 2)) }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }), 'excalidraw: scene command')

  ctx.effect(() => ctx.commands.register({
    name: 'excalidraw-export',
    description: 'Run one low-level excalidraw_export operation from JSON',
    input: { hint: '<JSON: {"path":"diagram.excalidraw","format":"png","scale":2}>' },
    recordInput: true,
    async handler(invocation) {
      const raw = invocation.rawInput.trim()
      if (raw.length === 0) return { kind: 'error', text: 'Usage: /excalidraw-export <JSON object>' }
      let payload
      try {
        payload = JSON.parse(raw)
      } catch (error) {
        return { kind: 'error', text: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
      }
      try {
        const value = await service.runExportCommand(invocation.agent, payload, invocation.signal)
        return {
          kind: 'success',
          text: [
            `Exported ${value.path} as ${value.format.toUpperCase()} (version ${value.version}, ${value.bytes} bytes).`,
            `Download: ${value.downloadUrl}`,
            `Attachment id: ${value.attachment?.attachmentId ?? '(none)'}`,
          ].join('\n'),
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }), 'excalidraw: export command')
}

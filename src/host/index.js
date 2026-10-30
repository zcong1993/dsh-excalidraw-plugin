import { applyCommands } from './commands.js'
import { applyEvents } from './events.js'
import { applyRoutes } from './routes.js'
import { ExcalidrawService } from './service.js'
import { applySceneTools } from './tools.js'

/** Plugin name used by Cordis diagnostics. */
export const name = 'excalidraw-preview'

/** Services required for the source tools, commands, and browser edit surface. */
export const inject = [
  'tools',
  'commands',
  'fs',
  'webServer',
  'connection',
  'agents',
  'workingDirectory',
]

/**
 * Host half of the Excalidraw plugin: registers tools, commands, HTTP routes,
 * and coordination events around one shared business service.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 */
export function apply(ctx) {
  const service = new ExcalidrawService(ctx, ctx.logger)
  ctx.effect(() => () => service.dispose(), 'excalidraw: service disposal')
  applySceneTools(ctx, service)
  applyCommands(ctx, service)
  applyRoutes(ctx, service)
  applyEvents(ctx, service)
}

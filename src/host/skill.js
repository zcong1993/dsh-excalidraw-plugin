import skillSource from '../../.dsh/skills/excalidraw/SKILL.md'
import { splitSkillSource } from './skill-format.js'

const SKILL_NAME = 'excalidraw'
const FALLBACK_DESCRIPTION = '在 DSH 右侧画布创建、读取、修改并导出官方 Excalidraw 图。'
const RESOURCE_BASE = { kind: 'opaque', description: 'embedded in @zcong/dsh-excalidraw-plugin' }

/**
 * Register the natural-language entry point from inside the plugin so an
 * npm-installed bundle is self-contained. A project-level skill with the same
 * name outranks runtime registrations, so a workspace can still override it.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 */
export function applySkill(ctx) {
  ctx.inject(['skills'], (scope) => scope.effect(() => {
    const skill = splitSkillSource(skillSource)
    return scope.skills.register({
      name: SKILL_NAME,
      description: skill.description ?? FALLBACK_DESCRIPTION,
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      source: 'runtime',
      content: skill.body,
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: RESOURCE_BASE,
    })
  }, 'excalidraw: embedded skill'))
}


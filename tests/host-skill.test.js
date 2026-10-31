import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { splitSkillSource } from '../src/host/skill-format.js'

const SOURCE = readFileSync(new URL('../.dsh/skills/excalidraw/SKILL.md', import.meta.url), 'utf8')

describe('embedded skill source', () => {
  test('splits frontmatter fields from the model-facing body', () => {
    const skill = splitSkillSource(SOURCE)
    expect(skill.description).toContain('Excalidraw')
    expect(skill.whenToUse.length).toBeGreaterThan(0)
    expect(skill.body.trimStart().startsWith('# Excalidraw 绘图')).toBe(true)
    expect(skill.body).not.toContain('user-invocable')
    expect(skill.body).not.toContain('whenToUse:')
  })

  test('leaves a document without frontmatter untouched', () => {
    const skill = splitSkillSource('# Title\n\nbody')
    expect(skill).toEqual({ description: undefined, whenToUse: undefined, body: '# Title\n\nbody' })
  })

  test('maps disable-model-invocation to modelInvocable', () => {
    expect(splitSkillSource(SOURCE).modelInvocable).toBe(false)
    expect(splitSkillSource('---\ndisable-model-invocation: true\n---\nbody').modelInvocable).toBe(false)
    expect(splitSkillSource('---\ndisable-model-invocation: false\n---\nbody').modelInvocable).toBeUndefined()
    expect(splitSkillSource('---\ndescription: d\n---\nbody').modelInvocable).toBeUndefined()
  })
})

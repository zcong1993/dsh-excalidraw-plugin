/**
 * Split YAML frontmatter from the Markdown body the model should read.
 * `disable-model-invocation: true` maps to `modelInvocable: false`; the key is
 * omitted otherwise so the caller keeps its default.
 * @param {string} source raw SKILL.md
 * @returns {{description?: string, whenToUse?: string, modelInvocable?: boolean, body: string}}
 */
export function splitSkillSource(source) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (frontmatter === null) return { body: source }
  const fields = {}
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (entry !== null) fields[entry[1]] = entry[2].trim()
  }
  const modelDisabled = /^(true|yes|1)$/i.test(fields['disable-model-invocation'] ?? '')
  return {
    description: fields.description,
    whenToUse: fields.whenToUse,
    ...(modelDisabled ? { modelInvocable: false } : {}),
    body: source.slice(frontmatter[0].length),
  }
}

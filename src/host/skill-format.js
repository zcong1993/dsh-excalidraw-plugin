/**
 * Split YAML frontmatter from the Markdown body the model should read.
 * @param {string} source raw SKILL.md
 * @returns {{description?: string, whenToUse?: string, body: string}}
 */
export function splitSkillSource(source) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (frontmatter === null) return { body: source }
  const fields = {}
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (entry !== null) fields[entry[1]] = entry[2].trim()
  }
  return {
    description: fields.description,
    whenToUse: fields.whenToUse,
    body: source.slice(frontmatter[0].length),
  }
}

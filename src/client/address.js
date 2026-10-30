/** `dsh-resource://file/...` address helpers shared by the watcher and body. */

const PREFIX = 'dsh-resource://file/'

function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

export function sessionFileAddress(sessionId, path) {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const encoded = normalized.split('/').map(encodeSegment).join('/')
  return `${PREFIX}session/${encodeSegment(sessionId)}/${encoded}`
}

export function parseFileAddress(address) {
  try {
    if (typeof address !== 'string' || !address.startsWith(PREFIX)) return undefined
    const end = address.search(/[?#]/)
    const parts = address.slice(PREFIX.length, end === -1 ? undefined : end).split('/')
    if (parts[0] !== 'session') return undefined
    const [, sessionId, ...segments] = parts
    if (sessionId === undefined || sessionId === '' || segments.length === 0) return undefined
    return {
      scope: 'session',
      sessionId: decodeURIComponent(sessionId),
      path: segments.map((segment) => decodeURIComponent(segment)).join('/'),
    }
  } catch {
    return undefined
  }
}

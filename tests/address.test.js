import { describe, expect, test } from 'bun:test'
import { parseFileAddress, sessionFileAddress } from '../src/client/address.js'

const PREFIX = 'dsh-resource://file/'

describe('workspace file addresses', () => {
  test('round-trips a nested relative path', () => {
    const address = sessionFileAddress('s1', 'diagrams/flow.excalidraw')
    expect(address).toBe(`${PREFIX}session/s1/diagrams/flow.excalidraw`)
    expect(parseFileAddress(address)).toEqual({
      scope: 'session',
      sessionId: 's1',
      path: 'diagrams/flow.excalidraw',
    })
  })

  test('normalizes backslashes and leading dot segments', () => {
    expect(sessionFileAddress('s1', '.\\a\\b.excalidraw'))
      .toBe(`${PREFIX}session/s1/a/b.excalidraw`)
    expect(sessionFileAddress('s1', './a/./b.excalidraw'))
      .toBe(`${PREFIX}session/s1/a/./b.excalidraw`)
  })

  test('encodes spaces, delimiters, and unicode without losing them', () => {
    const path = 'a b/图 #1?.excalidraw'
    const address = sessionFileAddress('s 1', path)
    expect(address).toContain('a%20b')
    expect(parseFileAddress(address)).toEqual({ scope: 'session', sessionId: 's 1', path })
  })

  test('keeps a colon readable in file names', () => {
    expect(sessionFileAddress('s1', 'a:b.excalidraw')).toContain('a:b.excalidraw')
  })

  test('ignores query and hash suffixes when parsing', () => {
    expect(parseFileAddress(`${PREFIX}session/s1/a.excalidraw?x=1#part`)).toEqual({
      scope: 'session',
      sessionId: 's1',
      path: 'a.excalidraw',
    })
  })

  test('rejects malformed or foreign addresses', () => {
    expect(parseFileAddress(undefined)).toBeUndefined()
    expect(parseFileAddress(42)).toBeUndefined()
    expect(parseFileAddress('https://example.com/session/s1/a.excalidraw')).toBeUndefined()
    expect(parseFileAddress(`${PREFIX}workspace/s1/a.excalidraw`)).toBeUndefined()
    expect(parseFileAddress(`${PREFIX}session/`)).toBeUndefined()
    expect(parseFileAddress(`${PREFIX}session/s1`)).toBeUndefined()
    expect(parseFileAddress(`${PREFIX}session/s1/`)).toEqual({ scope: 'session', sessionId: 's1', path: '' })
    expect(parseFileAddress(`${PREFIX}session/%E0%A4%A/a.excalidraw`)).toBeUndefined()
  })
})

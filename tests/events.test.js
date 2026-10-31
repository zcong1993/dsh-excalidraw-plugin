import { describe, expect, test } from 'bun:test'
import { applyEvents } from '../src/host/events.js'

function setup(text) {
  const calls = { built: 0 }
  const handlers = new Map()
  const service = {
    transactions: new Map(),
    setAgentStatus() {},
    setWorking() {},
    endTransaction() {},
    async buildUserChangeText() {
      calls.built += 1
      return text
    },
  }
  const ctx = {
    effect(run) {
      return run()
    },
    on(name, handler) {
      handlers.set(name, handler)
      return () => {}
    },
  }
  applyEvents(ctx, service)
  return { handlers, calls, service }
}

function userMessage(id, text) {
  return {
    id,
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  }
}

function runtimeContext(id) {
  return {
    id,
    role: 'user',
    source: { kind: 'runtime-context' },
    content: [{ type: 'text', text: 'workspace context' }],
  }
}

function preStep(handler, messages) {
  return handler(
    { agent: { id: 's1' }, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages }),
  )
}

describe('user change summary wiring', () => {
  test('appends the canvas block to the human message instead of adding a message', async () => {
    const { handlers, calls } = setup('[canvas] a.excalidraw · 1 change\n- update rectangle "r1": x 0→50')
    const prompt = userMessage('m1', '看看这张图')
    const result = await preStep(handlers.get('agent/pre-step'), [runtimeContext('c1'), prompt])
    expect(result.messages.length).toBe(2)
    expect(result.messages[1].id).toBe('m1')
    expect(result.messages[1].content.length).toBe(2)
    expect(result.messages[1].content[0].text).toBe('看看这张图')
    expect(result.messages[1].content[1]).toEqual({
      type: 'text',
      text: '[canvas] a.excalidraw · 1 change\n- update rectangle "r1": x 0→50',
    })
    expect(result.messages[0].content[0].text).toBe('workspace context')
    expect(calls.built).toBe(1)
  })

  test('leaves a step without a human message untouched', async () => {
    const { handlers, calls } = setup('should not appear')
    const result = await preStep(handlers.get('agent/pre-step'), [runtimeContext('c1')])
    expect(result.messages.length).toBe(1)
    expect(result.messages[0].content.length).toBe(1)
    expect(calls.built).toBe(0)
  })

  test('does nothing when the canvas did not change', async () => {
    const { handlers } = setup(undefined)
    const prompt = userMessage('m1', '看看这张图')
    const result = await preStep(handlers.get('agent/pre-step'), [prompt])
    expect(result.messages).toEqual([prompt])
  })
})

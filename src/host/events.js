/**
 * Host event wiring: agent working state, transaction cleanup, and the compact
 * canvas block attached to the user's next message.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {import('./service.js').ExcalidrawService} service shared business service
 */
export function applyEvents(ctx, service) {
  ctx.effect(() => ctx.on('agent/status', (payload) => {
    const agent = payload?.agent
    if (agent === undefined) return
    service.setAgentStatus(agent.id, payload.status)
  }), 'excalidraw: agent status')

  ctx.effect(() => ctx.on('agent/disposed', (payload) => {
    const agent = payload?.agent
    if (agent === undefined) return
    service.setWorking(agent.id, false)
    for (const [transactionId, transaction] of service.transactions) {
      if (transaction.sessionId === agent.id) service.endTransaction(transactionId)
    }
  }), 'excalidraw: agent disposed')

  ctx.effect(() => ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    if (payload?.signal?.aborted) return decision
    const index = lastUserMessageIndex(decision.messages)
    if (index === -1) return decision
    const text = await service.buildUserChangeText(payload.agent, payload.signal)
    if (text === undefined) return decision
    const messages = [...decision.messages]
    const message = messages[index]
    messages[index] = {
      ...message,
      content: [...message.content, { type: 'text', text }],
    }
    return { ...decision, messages }
  }), 'excalidraw: user change summary')
}

/**
 * Index of the last message the human actually wrote. Runtime-context messages
 * also carry the user role, so only `source.kind === 'user'` qualifies.
 * @param {readonly object[]} messages messages entering the step
 * @returns {number} index, or -1 when the step has no human message
 */
function lastUserMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && message.source?.kind === 'user') return index
  }
  return -1
}

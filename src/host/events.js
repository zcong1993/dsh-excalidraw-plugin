/**
 * Host event wiring: agent working state, transaction cleanup, and the bounded
 * user-change message that follows a committed canvas edit.
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
    if (!decision.messages.some((message) => message.role === 'user')) return decision
    const summary = await service.buildUserChangeMessage(payload.agent, payload.signal)
    if (summary === undefined) return decision
    return {
      ...decision,
      messages: [...decision.messages, summary],
    }
  }), 'excalidraw: user change summary')
}

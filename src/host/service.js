import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import {
  LIMITS,
  ExcalidrawError,
  diffDocuments,
  fail,
  formatDiffForModel,
  mergeEditorState,
  parseDocument,
  sceneBounds,
  serializeDocument,
  summarizeElements,
  validateDocument,
  applyUpdates,
} from './document.js'

const FLUSH_TIMEOUT_MS = 10_000
const TRANSACTION_TIMEOUT_MS = 120_000
const EXPORT_TIMEOUT_MS = 60_000
const PREVIEW_TTL_MS = 5 * 60_000
const DOWNLOAD_TTL_MS = 60_000
const MAX_EXPORT_BYTES = 32 * 1024 * 1024
const MAX_EXPORT_PIXELS = 16_777_216
const MAX_EXPORT_SIDE = 16_384
const MAX_BODY_BYTES = 48 * 1024 * 1024

function token(bytes = 24) {
  return randomBytes(bytes).toString('base64url')
}

function now() {
  return Date.now()
}

function isExcalidrawPath(path) {
  return typeof path === 'string' && /\.excalidraw$/i.test(path)
}

function sessionIdOf(agent) {
  return agent?.id ?? agent?.session?.id
}

function messageFor(error) {
  if (error instanceof ExcalidrawError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

function errorCode(error) {
  if (error instanceof ExcalidrawError) return error.code
  if (error && typeof error === 'object' && typeof error.code === 'string') return error.code
  return 'INTERNAL'
}

function currentVersionOf(error) {
  if (error instanceof ExcalidrawError && typeof error.details?.currentVersion === 'string') {
    return error.details.currentVersion
  }
  return undefined
}

function toError(error) {
  if (error instanceof ExcalidrawError) return error
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return new ExcalidrawError(error.code, messageFor(error), { cause: error })
  }
  return new ExcalidrawError('INTERNAL', messageFor(error), { cause: error })
}

function isWorkingStatus(agent) {
  return agent?.status === 'running' || agent?.status === 'waiting'
}

/**
 * One shared business implementation for tools, commands, and browser routes.
 * All source I/O goes through `ctx.fs` with the Session's sandbox policy.
 */
export class ExcalidrawService {
  constructor(ctx, logger) {
    this.ctx = ctx
    this.logger = logger
    this.connections = new Map()
    this.sessionConnections = new Map()
    this.pendingPreviews = new Map()
    this.transactions = new Map()
    this.exportTasks = new Map()
    this.downloads = new Map()
    this.working = new Map()
    this.pendingDiffs = new Map()
    this.fileCache = new Map()
    this.opResults = new Map()
    this.disposed = false
  }

  /* ------------------------------------------------------------------ *
   * Session and file helpers
   * ------------------------------------------------------------------ */

  agentFor(sessionId) {
    return this.ctx.get('agents')?.get(sessionId)
  }

  sessionFor(agentOrId) {
    if (typeof agentOrId === 'string') return this.agentFor(agentOrId)?.session
    return agentOrId?.session
  }

  sessionIdFor(agent) {
    return sessionIdOf(agent)
  }

  isWorking(sessionId) {
    if (this.working.has(sessionId)) return this.working.get(sessionId)
    const agent = this.agentFor(sessionId)
    return agent === undefined ? false : isWorkingStatus(agent)
  }

  setWorking(sessionId, working) {
    if (this.disposed) return
    const wasWorking = this.isWorking(sessionId)
    this.working.set(sessionId, working)
    if (working && !wasWorking) {
      this.pruneStaleConnections(sessionId)
      for (const conn of this.connectionsFor(sessionId)) {
        if (!conn.open || !conn.dirty || this.isConnectionStale(conn)) continue
        this.requestFlushForConnection(conn, 'agent-start', FLUSH_TIMEOUT_MS).catch((error) => {
          this.logger?.warn?.(`excalidraw: agent-start flush failed for ${conn.absolutePath}: ${messageFor(error)}`)
        })
      }
    }
  }

  setAgentStatus(sessionId, status) {
    this.setWorking(sessionId, status === 'running' || status === 'waiting')
  }

  policyFor(agent) {
    const policy = this.ctx.get('sandboxPolicy')
    if (policy === undefined) return undefined
    const session = this.sessionFor(agent)
    return policy.resolve(session === undefined ? {} : { session })
  }

  cwdFor(agent, signal) {
    const workingDirectory = this.ctx.get('workingDirectory')
    if (workingDirectory === undefined) throw fail('UNAVAILABLE', 'the working-directory service is not available')
    return workingDirectory.ensure(agent, signal)
  }

  async resolveTarget(agent, path, signal, { requireExisting = false } = {}) {
    if (!isExcalidrawPath(path)) throw fail('INVALID_PATH', 'only *.excalidraw paths are accepted')
    const fs = this.ctx.get('fs')
    if (fs === undefined) throw fail('UNAVAILABLE', 'the filesystem service is not available')
    const cwd = await this.cwdFor(agent, signal)
    let lstat
    try {
      lstat = await fs.lstat(path, { cwd }, signal)
    } catch (error) {
      if (error?.code !== 'FS_NOT_FOUND') throw toError(error)
    }
    if (lstat?.type === 'symlink') {
      throw fail('PATH_IDENTITY_CHANGED', `"${path}" is a symbolic link; Excalidraw sources must be regular files`)
    }
    const target = await fs.resolve(path, { cwd, signal })
    if (requireExisting && lstat === undefined) {
      throw fail('NOT_FOUND', `"${path}" does not exist`)
    }
    return { target, absolutePath: fs.processPath(target), cwd, fs }
  }

  emitObserved(target, observation, agent) {
    try {
      this.ctx.emit('fs/observed', target, observation, agent ?? undefined)
    } catch {
      // Observation recording must never turn a successful read into a failure.
    }
  }

  async statState(agent, path, signal) {
    const resolved = await this.resolveTarget(agent, path, signal)
    const info = await resolved.fs.stat(resolved.target, signal)
    return { ...resolved, info }
  }

  async readState(agent, path, signal, { cacheOnly = false } = {}) {
    const resolved = await this.resolveTarget(agent, path, signal, { requireExisting: true })
    const info = await resolved.fs.stat(resolved.target, signal)
    if (info === undefined) {
      this.emitObserved(resolved.target, { kind: 'absent' }, agent)
      throw fail('NOT_FOUND', `"${path}" does not exist`)
    }
    if (info.type !== 'file') throw fail('NOT_REGULAR_FILE', `"${path}" is not a regular file`)
    if (info.size !== undefined && info.size > LIMITS.maxDocumentBytes) {
      throw fail('DOCUMENT_TOO_LARGE', `"${path}" exceeds ${LIMITS.maxDocumentBytes} bytes`)
    }
    const cached = this.fileCache.get(resolved.target.targetKey)
    if (cacheOnly && cached !== undefined && cached.version === info.version) {
      return { ...resolved, info, document: cached.document, text: cached.text, version: info.version }
    }
    const text = await resolved.fs.readText(resolved.target, signal)
    const document = parseDocument(text)
    this.emitObserved(resolved.target, { kind: 'present', version: info.version }, agent)
    this.fileCache.set(resolved.target.targetKey, { document, text, version: info.version, path: resolved.absolutePath })
    return { ...resolved, info, document, text, version: info.version }
  }

  async writeDocument(agent, resolved, document, intent, signal) {
    validateDocument(document)
    const text = serializeDocument(document)
    const policy = this.policyFor(agent)
    let outcome
    try {
      outcome = await resolved.fs.writeText(resolved.target, text, intent, signal, policy)
    } catch (error) {
      const mapped = toError(error)
      if (mapped.code === 'FS_STALE_VERSION' || mapped.code === 'FS_CONFLICT') {
        const info = await resolved.fs.stat(resolved.target, signal).catch(() => undefined)
        throw fail('VERSION_CONFLICT', 'the source file changed since the locked baseline', {
          currentVersion: info?.version,
          cause: mapped,
        })
      }
      if (mapped.code === 'FS_SANDBOX_DENIED') {
        throw fail('PERMISSION_DENIED', 'the sandbox policy refused this write; the canvas cannot be edited in this Session')
      }
      throw mapped
    }
    this.emitObserved(resolved.target, { kind: 'present', version: outcome.version }, agent)
    this.fileCache.set(resolved.target.targetKey, {
      document,
      text,
      version: outcome.version,
      path: resolved.absolutePath,
    })
    return { outcome, text }
  }

  requireAttachments() {
    const attachments = this.ctx.get('attachments')
    if (attachments === undefined) {
      throw fail('ATTACHMENT_UNAVAILABLE', 'the attachment service is not mounted; export results cannot be stored')
    }
    return attachments
  }

  /* ------------------------------------------------------------------ *
   * Tools: create/read/begin/update/end
   * ------------------------------------------------------------------ */

  async create(agent, path, document, signal) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) throw fail('UNAVAILABLE', 'the filesystem service is not available')
    validateDocument(document)
    const resolved = await this.resolveTarget(agent, path, signal)
    const lstat = await fs.lstat(path, { cwd: resolved.cwd }, signal).catch((error) => {
      if (error?.code === 'FS_NOT_FOUND') return undefined
      throw toError(error)
    })
    if (lstat !== undefined) {
      if (lstat.type === 'symlink') throw fail('PATH_EXISTS', `"${path}" is a symbolic link; refusing to overwrite it`)
      throw fail('PATH_EXISTS', `"${path}" already exists; create requires an absent path`)
    }
    const info = await fs.stat(resolved.target, signal)
    if (info !== undefined) throw fail('PATH_EXISTS', `"${path}" already exists; create requires an absent path`)
    this.emitObserved(resolved.target, { kind: 'absent' }, agent)
    const { outcome } = await this.writeDocument(agent, resolved, document, { kind: 'createIfAbsent' }, signal)
    const summary = summarizeElements(document)
    return {
      created: true,
      path: resolved.absolutePath,
      version: String(outcome.version),
      ...summary,
    }
  }

  async read(agent, args, signal) {
    const { transactionId, format = 'summary', ids, offset, limit } = args
    if (format !== 'summary' && format !== 'document') throw fail('INVALID_ARGUMENT', 'format must be "summary" or "document"')
    if (format === 'document' && (ids !== undefined || offset !== undefined || limit !== undefined)) {
      throw fail('INVALID_ARGUMENT', 'format:"document" cannot be combined with ids, offset, or limit')
    }
    if (transactionId !== undefined) {
      const transaction = this.requireTransaction(transactionId, agent)
      return this.readResult(transaction.absolutePath, transaction.baseDocument, transaction.baseVersion, format, { ids, offset, limit }, transactionId)
    }
    if (typeof args.path !== 'string' || args.path.length === 0) {
      throw fail('INVALID_ARGUMENT', 'read requires path or transactionId')
    }
    const sessionId = sessionIdOf(agent)
    await this.flushSession(sessionId, 'read', signal)
    const state = await this.readState(agent, args.path, signal)
    return this.readResult(state.absolutePath, state.document, state.version, format, { ids, offset, limit })
  }

  readResult(path, document, version, format, options, transactionId) {
    if (format === 'document') {
      return { path, version: String(version), format: 'document', document, ...(transactionId ? { transactionId } : {}) }
    }
    const summary = summarizeElements(document, options)
    return { path, version: String(version), format: 'summary', ...(transactionId ? { transactionId } : {}), ...summary }
  }

  requireTransaction(transactionId, agent) {
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw fail('INVALID_ARGUMENT', 'transactionId must be a non-empty string')
    }
    const transaction = this.transactions.get(transactionId)
    if (transaction === undefined) throw fail('TRANSACTION_NOT_FOUND', 'the transaction is unknown or already ended')
    if (transaction.sessionId !== sessionIdOf(agent)) {
      throw fail('TRANSACTION_DENIED', 'the transaction belongs to a different Session')
    }
    if (transaction.deadlineAt < now()) {
      this.endTransaction(transactionId)
      throw fail('TRANSACTION_EXPIRED', 'the transaction expired before it was committed')
    }
    return transaction
  }

  async begin(agent, args, signal) {
    if (typeof args.path !== 'string' || args.path.length === 0) throw fail('INVALID_ARGUMENT', 'begin requires path')
    const sessionId = sessionIdOf(agent)
    await this.flushSession(sessionId, 'begin', signal, { force: true })
    const state = await this.readState(agent, args.path, signal)
    const transactionId = token(18)
    const deadlineAt = now() + TRANSACTION_TIMEOUT_MS
    const timer = setTimeout(() => {
      this.endTransaction(transactionId)
    }, TRANSACTION_TIMEOUT_MS)
    timer.unref?.()
    for (const existing of this.transactions.values()) {
      if (existing.targetKey === state.target.targetKey) {
        throw fail('TRANSACTION_LOCKED', 'another Agent transaction already holds this source; wait for it to end')
      }
    }
    const transaction = {
      transactionId,
      sessionId,
      target: state.target,
      targetKey: state.target.targetKey,
      absolutePath: state.absolutePath,
      baseDocument: state.document,
      baseVersion: String(state.version),
      deadlineAt,
      timer,
    }
    this.transactions.set(transactionId, transaction)
    const result = this.readResult(
      state.absolutePath,
      state.document,
      state.version,
      args.format === 'document' ? 'document' : 'summary',
      { ids: args.ids, offset: args.offset, limit: args.limit },
      transactionId,
    )
    return {
      transactionId,
      version: String(state.version),
      deadlineAt,
      ...result,
    }
  }

  endTransaction(transactionId) {
    const transaction = this.transactions.get(transactionId)
    if (transaction === undefined) return
    clearTimeout(transaction.timer)
    this.transactions.delete(transactionId)
  }

  async update(agent, args, signal) {
    const transaction = this.requireTransaction(args.transactionId, agent)
    this.endTransaction(transaction.transactionId)
    const expectedVersion = args.expectedVersion
    if (expectedVersion === undefined || String(expectedVersion) !== transaction.baseVersion) {
      throw fail('VERSION_CONFLICT', `expectedVersion ${String(expectedVersion ?? '(missing)')} does not match the locked baseline ${transaction.baseVersion}`, {
        currentVersion: transaction.baseVersion,
      })
    }
    const hasUpdates = args.updates !== undefined
    const hasDocument = args.document !== undefined
    if (hasUpdates === hasDocument) throw fail('INVALID_ARGUMENT', 'update requires exactly one of updates or document')
    const next = hasDocument
      ? validateDocument(structuredClone(args.document))
      : applyUpdates(transaction.baseDocument, args.updates)

    const before = transaction.baseDocument
    const resolved = {
      target: transaction.target,
      absolutePath: transaction.absolutePath,
      fs: this.ctx.get('fs'),
    }
    if (resolved.fs === undefined) throw fail('UNAVAILABLE', 'the filesystem service is not available')
    const { outcome } = await this.writeDocument(agent, resolved, next, { kind: 'replaceIfVersion', version: transaction.baseVersion }, signal)
    const version = String(outcome.version)
    const diff = diffDocuments(before, next, {
      path: transaction.absolutePath,
      fromVersion: transaction.baseVersion,
      toVersion: version,
    })
    return {
      path: transaction.absolutePath,
      transactionId: transaction.transactionId,
      version,
      ended: true,
      changed: diff.totalChanges,
      truncated: diff.truncated,
      ...summarizeElements(next, { limit: args.limit, offset: args.offset }),
    }
  }

  async end(agent, transactionId) {
    this.requireTransaction(transactionId, agent)
    this.endTransaction(transactionId)
    return { transactionId, ended: true }
  }

  /* ------------------------------------------------------------------ *
   * Preview and browser connections
   * ------------------------------------------------------------------ */

  async preview(agent, path, signal) {
    if (typeof path !== 'string' || path.length === 0) throw fail('INVALID_ARGUMENT', 'preview requires path')
    const sessionId = sessionIdOf(agent)
    await this.flushSession(sessionId, 'preview', signal, { force: true })
    const state = await this.readState(agent, path, signal)
    const previewToken = token()
    const expiresAt = now() + PREVIEW_TTL_MS
    this.pendingPreviews.set(sessionId, {
      sessionId,
      path: state.absolutePath,
      requestedPath: path,
      absolutePath: state.absolutePath,
      version: String(state.version),
      token: previewToken,
      createdAt: now(),
      expiresAt,
      opened: false,
    })
    return {
      path: state.absolutePath,
      version: String(state.version),
      sessionId,
      opened: false,
      expiresAt,
    }
  }

  pendingPreview(sessionId) {
    const pending = this.pendingPreviews.get(sessionId)
    if (pending === undefined) return undefined
    if (pending.expiresAt < now()) {
      this.pendingPreviews.delete(sessionId)
      return undefined
    }
    if (pending.opened) return undefined
    return pending
  }

  markPreviewOpened(sessionId, tokenValue) {
    const pending = this.pendingPreviews.get(sessionId)
    if (pending !== undefined && (tokenValue === undefined || pending.token === tokenValue)) {
      pending.opened = true
    }
  }

  connectionsFor(sessionId) {
    return [...(this.sessionConnections.get(sessionId) ?? [])]
      .map((id) => this.connections.get(id))
      .filter(Boolean)
  }

  isConnectionStale(conn) {
    return !conn.open || now() - conn.lastSeen > 5_000
  }

  pruneStaleConnections(sessionId) {
    for (const conn of this.connectionsFor(sessionId)) {
      if (!this.isConnectionStale(conn)) continue
      conn.open = false
      if (conn.flush !== null) this.rejectFlush(conn, new ExcalidrawError('CLOSED', 'the canvas stopped polling'))
      this.connections.delete(conn.token)
      this.sessionConnections.get(sessionId)?.delete(conn.token)
    }
  }

  requireConnection(tokenValue, sessionId) {
    if (typeof tokenValue !== 'string' || tokenValue.length === 0) throw fail('UNAUTHORIZED', 'missing connection token')
    const conn = this.connections.get(tokenValue)
    if (conn === undefined) throw fail('NOT_OPEN', 'the canvas connection is not open; reopen the file')
    if (sessionId !== undefined && conn.sessionId !== sessionId) throw fail('UNAUTHORIZED', 'the connection belongs to a different Session')
    if (!conn.open) throw fail('CLOSED', 'the canvas connection is closed')
    return conn
  }

  async openCanvas({ sessionId, path, token: requestedToken, signal }) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw fail('INVALID_ARGUMENT', 'sessionId is required')
    const agent = this.agentFor(sessionId)
    if (agent === undefined) throw fail('SESSION_UNAVAILABLE', 'the Session is not live; reopen the Session before editing')
    let tokenValue = requestedToken
    if (tokenValue !== undefined) {
      const pending = this.pendingPreviews.get(sessionId)
      const existing = this.connections.get(tokenValue)
      const validPending = pending !== undefined && pending.token === tokenValue && pending.path === path
      if (!validPending && existing === undefined) throw fail('UNAUTHORIZED', 'the preview token is invalid or expired')
    } else {
      const pending = this.pendingPreviews.get(sessionId)
      tokenValue = pending !== undefined && (path === undefined || pending.path === path) ? pending.token : token()
    }
    const targetPath = path ?? this.pendingPreviews.get(sessionId)?.path
    if (targetPath === undefined) throw fail('INVALID_ARGUMENT', 'path is required')
    const state = await this.readState(agent, targetPath, signal)
    for (const conn of this.connectionsFor(sessionId)) {
      if (conn.open && conn.path === state.absolutePath && conn.token !== tokenValue) {
        conn.open = false
        this.connections.delete(conn.token)
      }
    }
    const conn = {
      token: tokenValue,
      sessionId,
      path: state.absolutePath,
      absolutePath: state.absolutePath,
      target: state.target,
      version: String(state.version),
      document: state.document,
      dirty: false,
      lastSeen: now(),
      open: true,
      flush: null,
      opResults: new Map(),
    }
    this.connections.set(tokenValue, conn)
    if (!this.sessionConnections.has(sessionId)) this.sessionConnections.set(sessionId, new Set())
    this.sessionConnections.get(sessionId).add(tokenValue)
    this.pendingPreviews.delete(sessionId)
    return {
      token: tokenValue,
      sessionId,
      path: state.absolutePath,
      version: conn.version,
      document: state.document,
      working: this.isWorking(sessionId),
      canEdit: !this.isWorking(sessionId),
    }
  }

  async snapshot({ sessionId, token, path, signal }) {
    const conn = this.requireConnection(token, sessionId)
    if (path !== undefined && path !== conn.path) throw fail('INVALID_ARGUMENT', 'path does not match the open canvas')
    const agent = this.agentFor(sessionId)
    if (agent === undefined) throw fail('SESSION_UNAVAILABLE', 'the Session is not live')
    const state = await this.readState(agent, conn.path, signal)
    conn.version = String(state.version)
    conn.document = state.document
    conn.lastSeen = now()
    return {
      sessionId,
      path: conn.path,
      version: conn.version,
      document: state.document,
      working: this.isWorking(sessionId),
      canEdit: !this.isWorking(sessionId) && !this.hasTransactionForPath(conn.target.targetKey),
    }
  }

  hasTransaction(sessionId) {
    for (const transaction of this.transactions.values()) {
      if (transaction.sessionId === sessionId) return true
    }
    return false
  }

  hasTransactionForPath(targetKey) {
    for (const transaction of this.transactions.values()) {
      if (transaction.targetKey === targetKey) return true
    }
    return false
  }

  async commit(input, signal) {
    const { sessionId, token: tokenValue, baseVersion, opId, elements, document, files, appStatePatch, flushId } = input
    const conn = this.requireConnection(tokenValue, sessionId)
    if (typeof baseVersion !== 'string' || baseVersion.length === 0) throw fail('INVALID_ARGUMENT', 'baseVersion is required')
    if (typeof opId !== 'string' || opId.length === 0 || opId.length > 256) throw fail('INVALID_ARGUMENT', 'opId is required')
    const idempotent = conn.opResults.get(opId)
    if (idempotent !== undefined) return idempotent
    const working = this.isWorking(sessionId)
    const flushMatch = conn.flush !== null && (flushId === undefined || conn.flush.id === flushId)
    if (this.hasTransactionForPath(conn.target.targetKey)) {
      throw fail('LOCKED', 'an Agent transaction holds this source; editing resumes after it ends')
    }
    if (working && !flushMatch) throw fail('LOCKED', 'the Agent is working on this canvas; editing resumes when it becomes idle')
    if (baseVersion !== conn.version) {
      throw fail('VERSION_CONFLICT', 'the canvas baseline is stale', { currentVersion: conn.version })
    }
    const agent = this.agentFor(sessionId)
    if (agent === undefined) throw fail('SESSION_UNAVAILABLE', 'the Session is not live')
    const fs = this.ctx.get('fs')
    if (fs === undefined) throw fail('UNAVAILABLE', 'the filesystem service is not available')
    const info = await fs.stat(conn.target, signal)
    if (info === undefined) throw fail('NOT_FOUND', 'the source file was removed outside the canvas')
    if (String(info.version) !== baseVersion) {
      throw fail('VERSION_CONFLICT', 'the source file changed outside the canvas', { currentVersion: String(info.version) })
    }
    const before = conn.document
    const resolved = { target: conn.target, absolutePath: conn.path, fs }
    let next
    if (document !== undefined) {
      next = validateDocument(structuredClone(document))
    } else {
      if (!Array.isArray(elements)) throw fail('INVALID_ARGUMENT', 'elements must be an array')
      next = mergeEditorState(before, { elements, files, appStatePatch })
    }
    let outcome
    try {
      const written = await this.writeDocument(agent, resolved, next, { kind: 'replaceIfVersion', version: baseVersion }, signal)
      outcome = written.outcome
    } catch (error) {
      if (conn.flush !== null) this.rejectFlush(conn, error)
      throw error
    }
    const version = String(outcome.version)
    const diff = diffDocuments(before, next, {
      path: conn.path,
      fromVersion: baseVersion,
      toVersion: version,
    })
    conn.version = version
    conn.document = next
    conn.dirty = false
    conn.lastSeen = now()
    if (flushMatch) this.resolveFlush(conn, version)
    if (diff.totalChanges > 0) {
      this.addPendingChange(sessionId, {
        path: conn.path,
        before,
        next,
        fromVersion: baseVersion,
        toVersion: version,
      })
    }
    const result = {
      version,
      savedAt: now(),
      changed: diff.totalChanges,
      truncated: diff.truncated,
      path: conn.path,
    }
    conn.opResults.set(opId, result)
    while (conn.opResults.size > 64) conn.opResults.delete(conn.opResults.keys().next().value)
    this.opResults.set(`${tokenValue}:${opId}`, result)
    return result
  }

  async ack({ sessionId, token: tokenValue, flushId, version, error }) {
    const conn = this.requireConnection(tokenValue, sessionId)
    conn.lastSeen = now()
    if (conn.flush !== null && (flushId === undefined || conn.flush.id === flushId)) {
      if (error) this.rejectFlush(conn, new ExcalidrawError('FLUSH_FAILED', String(error)))
      else this.resolveFlush(conn, version ?? conn.version)
    }
    return { acknowledged: true, version: conn.version }
  }

  async close({ sessionId, token: tokenValue }) {
    const conn = this.requireConnection(tokenValue, sessionId)
    conn.open = false
    this.connections.delete(tokenValue)
    this.sessionConnections.get(sessionId)?.delete(tokenValue)
    if (conn.flush !== null) this.rejectFlush(conn, new ExcalidrawError('CLOSED', 'the canvas closed before flushing its draft'))
    return { closed: true }
  }

  poll({ sessionId, token: tokenValue, path, knownVersion, dirty }) {
    const conn = this.requireConnection(tokenValue, sessionId)
    if (path !== undefined && path !== conn.path) throw fail('INVALID_ARGUMENT', 'path does not match the open canvas')
    conn.lastSeen = now()
    if (dirty !== undefined) conn.dirty = dirty === true
    const fs = this.ctx.get('fs')
    const currentVersion = fs === undefined
      ? conn.version
      : undefined
    // `poll` is intentionally synchronous for lower latency; version discovery
    // is performed by the async variant below.
    const tasks = []
    for (const task of this.exportTasks.values()) {
      if (task.status === 'settled' || task.status === 'failed') continue
      if (task.sessionId !== sessionId) continue
      if (task.path !== conn.path) continue
      tasks.push({
        taskId: task.taskId,
        format: task.format,
        scale: task.scale,
        transparent: task.transparent,
        path: task.path,
        version: task.version,
        claimed: task.claimedBy !== undefined,
      })
    }
    return {
      sessionId,
      path: conn.path,
      version: conn.version,
      knownVersion: knownVersion ?? null,
      working: this.isWorking(sessionId),
      canEdit: !this.isWorking(sessionId) && !this.hasTransactionForPath(conn.target.targetKey),
      transaction: this.hasTransaction(sessionId),
      dirty: conn.dirty,
      flush: conn.flush === null ? null : { id: conn.flush.id, reason: conn.flush.reason, deadlineAt: conn.flush.deadlineAt },
      exports: tasks,
      currentVersion: currentVersion ?? conn.version,
    }
  }

  async pollAsync(input, signal) {
    const conn = this.requireConnection(input.token, input.sessionId)
    const fs = this.ctx.get('fs')
    if (fs !== undefined) {
      const info = await fs.stat(conn.target, signal).catch(() => undefined)
      if (info !== undefined) {
        const live = String(info.version)
        if (live !== conn.version) {
          // Do not silently replace the locked baseline. The client decides
          // whether to reload (clean) or surface a conflict (dirty).
          const result = this.poll(input)
          return { ...result, version: live, externalChange: true }
        }
      } else {
        return { ...this.poll(input), missing: true }
      }
    }
    return this.poll(input)
  }

  /* ------------------------------------------------------------------ *
   * Flush coordination
   * ------------------------------------------------------------------ */

  async flushSession(sessionId, reason, signal, { force = false } = {}) {
    if (sessionId === undefined) return null
    this.pruneStaleConnections(sessionId)
    const conns = this.connectionsFor(sessionId).filter((conn) => conn.open && !this.isConnectionStale(conn) && (force || conn.dirty))
    if (conns.length === 0) return null
    const results = await Promise.all(conns.map((conn) => this.requestFlushForConnection(conn, reason, FLUSH_TIMEOUT_MS)))
    return results.filter(Boolean).at(-1) ?? null
  }

  requestFlushForConnection(conn, reason, timeoutMs) {
    if (!conn.open) return Promise.reject(new ExcalidrawError('CLOSED', 'the canvas is closed'))
    if (conn.flush !== null) return conn.flush.promise
    const id = token(12)
    let resolvePromise
    let rejectPromise
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    const deadlineAt = now() + timeoutMs
    const timer = setTimeout(() => {
      if (conn.flush?.id === id) {
        conn.flush = null
        conn.open = false
        this.connections.delete(conn.token)
        this.sessionConnections.get(conn.sessionId)?.delete(conn.token)
        rejectPromise(new ExcalidrawError('FLUSH_TIMEOUT', 'the canvas did not save its draft within 10 seconds'))
      }
    }, timeoutMs)
    timer.unref?.()
    conn.flush = { id, reason, beforeVersion: conn.version, deadlineAt, promise, resolve: resolvePromise, reject: rejectPromise, timer }
    return promise.finally(() => {
      clearTimeout(timer)
      if (conn.flush?.id === id) conn.flush = null
    })
  }

  resolveFlush(conn, version) {
    if (conn.flush === null) return
    const { resolve, timer } = conn.flush
    conn.flush = null
    clearTimeout(timer)
    resolve(version)
  }

  rejectFlush(conn, error) {
    if (conn.flush === null) return
    const { reject, timer } = conn.flush
    conn.flush = null
    clearTimeout(timer)
    reject(error)
  }

  /**
   * Queue a user commit for the next model-facing summary. Repeated commits to
   * the same source coalesce into one net diff, so a drag that is undone before
   * the next Agent step never reaches the model.
   */
  addPendingChange(sessionId, change) {
    if (!this.pendingDiffs.has(sessionId)) this.pendingDiffs.set(sessionId, new Map())
    const byPath = this.pendingDiffs.get(sessionId)
    const pending = byPath.get(change.path)
    if (pending === undefined) {
      byPath.set(change.path, change)
      return
    }
    pending.next = change.next
    pending.toVersion = change.toVersion
  }

  /**
   * Build the compact canvas block appended to the user's next message. Pending
   * commits coalesce per source first, so a drag that was undone contributes
   * nothing; a file whose net diff is empty contributes no header at all.
   * @returns {Promise<string | undefined>} block text, or undefined when the
   * canvas did not change and no draft warning is due
   */
  async buildUserChangeText(agent, signal) {
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return undefined
    let failure
    try {
      await this.flushSession(sessionId, 'user-message', signal, { force: true })
    } catch (error) {
      failure = error
    }
    const pending = this.pendingDiffs.get(sessionId)
    this.pendingDiffs.delete(sessionId)
    if (pending === undefined && failure === undefined) return undefined
    let cwd
    try {
      cwd = await this.cwdFor(agent, signal)
    } catch {
      cwd = undefined
    }
    const sections = []
    for (const change of pending?.values() ?? []) {
      const diff = diffDocuments(change.before, change.next, {
        path: change.path,
        fromVersion: change.fromVersion,
        toVersion: change.toVersion,
      })
      if (diff.totalChanges > 0) sections.push(formatDiffForModel(diff, { cwd }))
    }
    if (failure !== undefined) {
      sections.push(`[canvas] the last draft could not be committed: ${messageFor(failure)}`)
    }
    const text = sections.join('\n\n')
    return text.length === 0 ? undefined : text
  }

  /* ------------------------------------------------------------------ *
   * Export
   * ------------------------------------------------------------------ */

  async claimExport({ taskId, sessionId, token: tokenValue }) {
    const task = this.exportTasks.get(taskId)
    if (task === undefined) throw fail('EXPORT_NOT_FOUND', 'the export task is unknown or expired')
    if (task.sessionId !== sessionId) throw fail('UNAUTHORIZED', 'the export task belongs to a different Session')
    this.requireConnection(tokenValue, sessionId)
    if (task.status === 'settled') throw fail('EXPORT_SETTLED', 'the export task already settled')
    if (task.deadlineAt < now()) throw fail('EXPORT_EXPIRED', 'the export task deadline passed')
    task.claimedBy = tokenValue
    task.claimedAt = now()
    return {
      taskId,
      sessionId,
      path: task.path,
      version: task.version,
      format: task.format,
      scale: task.scale,
      transparent: task.transparent,
      document: task.document,
    }
  }

  async sourceExport({ taskId, sessionId, token: tokenValue }) {
    const task = this.exportTasks.get(taskId)
    if (task === undefined) throw fail('EXPORT_NOT_FOUND', 'the export task is unknown or expired')
    if (task.sessionId !== sessionId) throw fail('UNAUTHORIZED', 'the export task belongs to a different Session')
    this.requireConnection(tokenValue, sessionId)
    return { taskId, path: task.path, version: task.version, document: task.document }
  }

  async resultExport({ taskId, sessionId, token: tokenValue, version, format, data }) {
    const task = this.exportTasks.get(taskId)
    if (task === undefined) throw fail('EXPORT_NOT_FOUND', 'the export task is unknown or expired')
    if (task.sessionId !== sessionId) throw fail('UNAUTHORIZED', 'the export task belongs to a different Session')
    const conn = this.requireConnection(tokenValue, sessionId)
    if (task.status === 'settled') throw fail('EXPORT_SETTLED', 'the export task already settled')
    if (String(version) !== task.version) {
      throw fail('EXPORT_VERSION_CONFLICT', `export result is for version ${String(version)} but the locked source is ${task.version}`)
    }
    if (format !== task.format) throw fail('INVALID_EXPORT', 'the export result format does not match the task')
    if (typeof data !== 'string' || data.length === 0) throw fail('INVALID_EXPORT', 'the export result is empty')
    const bytes = Buffer.from(data, 'base64')
    if (bytes.byteLength === 0) throw fail('INVALID_EXPORT', 'the export result is empty')
    if (bytes.byteLength > MAX_EXPORT_BYTES) throw fail('EXPORT_TOO_LARGE', `the export exceeds ${MAX_EXPORT_BYTES} bytes`)
    if (task.format === 'png') validatePng(bytes)
    else validateSvg(bytes)
    const attachments = this.requireAttachments()
    const name = `${basename(task.path).replace(/\.excalidraw$/i, '')}.${task.format}`
    let attachment
    try {
      attachment = await attachments.saveFile({ data: bytes, name })
    } catch (error) {
      throw fail('ATTACHMENT_FAILED', `the export was rendered but could not be stored: ${messageFor(error)}`)
    }
    const downloadToken = token(24)
    const expiresAt = now() + DOWNLOAD_TTL_MS
    this.downloads.set(downloadToken, {
      data: bytes,
      name,
      format: task.format,
      expiresAt,
    })
    const timer = setTimeout(() => {
      this.downloads.delete(downloadToken)
    }, DOWNLOAD_TTL_MS)
    timer.unref?.()
    const result = {
      path: task.path,
      version: task.version,
      format: task.format,
      scale: task.scale,
      transparent: task.transparent,
      bytes: bytes.byteLength,
      attachment: {
        attachmentId: attachment.attachmentId,
        name: attachment.name,
        bytes: attachment.bytes,
      },
      downloadUrl: `/api/excalidraw-export/download?token=${encodeURIComponent(downloadToken)}`,
      expiresAt,
    }
    task.status = 'settled'
    this.exportTasks.delete(taskId)
    clearTimeout(task.timer)
    conn.lastSeen = now()
    const clean = JSON.parse(JSON.stringify(result))
    task.resolve(clean)
    return clean
  }

  failExport({ taskId, sessionId, token: tokenValue, message }) {
    const task = this.exportTasks.get(taskId)
    if (task === undefined) throw fail('EXPORT_NOT_FOUND', 'the export task is unknown or expired')
    if (task.sessionId !== sessionId) throw fail('UNAUTHORIZED', 'the export task belongs to a different Session')
    this.requireConnection(tokenValue, sessionId)
    if (task.status === 'settled') return { failed: false }
    task.status = 'failed'
    this.exportTasks.delete(taskId)
    clearTimeout(task.timer)
    task.reject(new ExcalidrawError('EXPORT_FAILED', message || 'the page could not render the export'))
    return { failed: true }
  }

  async exportScene(agent, args, signal) {
    const format = args.format ?? 'png'
    const scale = args.scale ?? 2
    const transparent = args.transparent ?? false
    if (format !== 'png' && format !== 'svg') throw fail('INVALID_ARGUMENT', 'format must be "png" or "svg"')
    if (!Number.isInteger(scale) || scale < 1 || scale > 3) throw fail('INVALID_ARGUMENT', 'scale must be 1, 2, or 3')
    if (typeof transparent !== 'boolean') throw fail('INVALID_ARGUMENT', 'transparent must be a boolean')
    if (typeof args.path !== 'string' || args.path.length === 0) throw fail('INVALID_ARGUMENT', 'export requires path')
    const sessionId = sessionIdOf(agent)
    const attachments = this.requireAttachments()
    void attachments
    await this.flushSession(sessionId, 'export', signal, { force: true })
    const state = await this.readState(agent, args.path, signal)
    const bounds = sceneBounds(state.document)
    if (bounds.count === 0) throw fail('EMPTY_SCENE', 'the diagram has no visible elements to export')
    if (format === 'png') {
      const width = Math.ceil(bounds.width * scale)
      const height = Math.ceil(bounds.height * scale)
      if (width <= 0 || height <= 0) throw fail('EMPTY_SCENE', 'the diagram has no drawable area')
      if (width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE) {
        throw fail('EXPORT_TOO_LARGE', `the PNG would be ${width}x${height}; each side must be at most ${MAX_EXPORT_SIDE}px`)
      }
      if (width * height > MAX_EXPORT_PIXELS) {
        throw fail('EXPORT_TOO_LARGE', `the PNG would allocate ${width * height} pixels; the limit is ${MAX_EXPORT_PIXELS}`)
      }
    }
    this.pruneStaleConnections(sessionId)
    const conn = this.connectionsFor(sessionId).find((candidate) => candidate.open && !this.isConnectionStale(candidate) && candidate.path === state.absolutePath)
    if (conn === undefined) {
      throw fail('NO_PAGE', 'no connected DSH page has this diagram open; call excalidraw_preview and open the canvas before exporting')
    }
    const taskId = token(18)
    let resolveTask
    let rejectTask
    const promise = new Promise((resolve, reject) => {
      resolveTask = resolve
      rejectTask = reject
    })
    const deadlineAt = now() + EXPORT_TIMEOUT_MS
    const timer = setTimeout(() => {
      if (!this.exportTasks.has(taskId)) return
      this.exportTasks.delete(taskId)
      rejectTask(new ExcalidrawError('EXPORT_TIMEOUT', 'the page did not render the export within 60 seconds'))
    }, EXPORT_TIMEOUT_MS)
    timer.unref?.()
    this.exportTasks.set(taskId, {
      taskId,
      sessionId,
      path: state.absolutePath,
      version: String(state.version),
      document: state.document,
      format,
      scale,
      transparent,
      deadlineAt,
      timer,
      status: 'pending',
      resolve: resolveTask,
      reject: rejectTask,
    })
    try {
      return await promise
    } finally {
      const task = this.exportTasks.get(taskId)
      if (task !== undefined) {
        clearTimeout(task.timer)
        this.exportTasks.delete(taskId)
      }
    }
  }

  getDownload(downloadToken) {
    const entry = this.downloads.get(downloadToken)
    if (entry === undefined) throw fail('DOWNLOAD_EXPIRED', 'the export download link expired or is unknown')
    if (entry.expiresAt < now()) {
      this.downloads.delete(downloadToken)
      throw fail('DOWNLOAD_EXPIRED', 'the export download link expired or is unknown')
    }
    return entry
  }

  /* ------------------------------------------------------------------ *
   * Commands
   * ------------------------------------------------------------------ */

  async runSceneCommand(agent, payload, signal) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw fail('INVALID_ARGUMENT', 'scene command expects a JSON object')
    }
    const action = payload.action
    if (action === 'create') return this.create(agent, payload.path, payload.document, signal)
    if (action === 'read') return this.read(agent, payload, signal)
    if (action === 'begin') return this.begin(agent, payload, signal)
    if (action === 'update') return this.update(agent, payload, signal)
    if (action === 'end') return this.end(agent, payload.transactionId)
    throw fail('INVALID_ACTION', 'action must be create, read, begin, update, or end')
  }

  async runExportCommand(agent, payload, signal) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw fail('INVALID_ARGUMENT', 'export command expects a JSON object')
    }
    return this.exportScene(agent, payload, signal)
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const transaction of this.transactions.values()) clearTimeout(transaction.timer)
    this.transactions.clear()
    for (const conn of this.connections.values()) {
      if (conn.flush !== null) this.rejectFlush(conn, new ExcalidrawError('CLOSED', 'the plugin unloaded before the canvas flushed its draft'))
      conn.open = false
    }
    this.connections.clear()
    this.sessionConnections.clear()
    for (const task of this.exportTasks.values()) {
      clearTimeout(task.timer)
      task.reject(new ExcalidrawError('CLOSED', 'the plugin unloaded before the export finished'))
    }
    this.exportTasks.clear()
    this.pendingPreviews.clear()
    this.downloads.clear()
  }
}

function validatePng(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.byteLength < 33 || !signature.every((value, index) => bytes[index] === value)) {
    throw fail('INVALID_EXPORT', 'the PNG result is not a valid PNG image')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width <= 0 || height <= 0) throw fail('INVALID_EXPORT', 'the PNG has invalid dimensions')
  if (width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE) {
    throw fail('EXPORT_TOO_LARGE', `the PNG is ${width}x${height}; each side must be at most ${MAX_EXPORT_SIDE}px`)
  }
  if (width * height > MAX_EXPORT_PIXELS) {
    throw fail('EXPORT_TOO_LARGE', `the PNG allocates ${width * height} pixels; the limit is ${MAX_EXPORT_PIXELS}`)
  }
}

function validateSvg(bytes) {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw fail('INVALID_EXPORT', 'the SVG result is not valid UTF-8')
  }
  const trimmed = text.trimStart()
  if (!/^<svg[\s>]/i.test(trimmed)) throw fail('INVALID_EXPORT', 'the SVG result does not start with an <svg> element')
  if (/<script[\s>]/i.test(text)) throw fail('UNSAFE_EXPORT', 'the exported SVG contains a script element')
  if (/<foreignObject[\s>]/i.test(text)) throw fail('UNSAFE_EXPORT', 'the exported SVG contains foreignObject content')
  if (/<(?:iframe|object|embed)[\s>]/i.test(text)) throw fail('UNSAFE_EXPORT', 'the exported SVG contains an active element')
  if (/\son[a-z]+\s*=/i.test(text)) throw fail('UNSAFE_EXPORT', 'the exported SVG contains an inline event handler')
  if (/javascript\s*:/i.test(text)) throw fail('UNSAFE_EXPORT', 'the exported SVG contains a javascript: URL')
  const external = /\b(?:href|xlink:href)\s*=\s*["'](?!\s*(?:#|data:image\/(?:png|jpeg|webp|gif)|data:font|data:application\/font))[^"']*/gi
  if (external.test(text)) throw fail('UNSAFE_EXPORT', 'the exported SVG references an external resource')
  if (/url\(\s*["']?(?:https?:|\/\/)/i.test(text)) throw fail('UNSAFE_EXPORT', 'the exported SVG references a remote stylesheet resource')
}

export { MAX_BODY_BYTES, MAX_EXPORT_PIXELS, MAX_EXPORT_SIDE, errorCode, currentVersionOf, messageFor, toError }

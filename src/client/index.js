import React from 'react'
import ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import { ApiError, createCanvasApi, markPreviewOpened, pendingPreview, requestPath } from './api.js'
import { parseFileAddress, sessionFileAddress } from './address.js'
import { DRAFT_MAX_BYTES, downloadDraft, draftStorageKey, loadDraft, makeDraft, removeDraft, saveDraft } from './draft.js'
import { checkPngBudget, filesSignature, originMoved, pickAppStatePatch } from './geometry.js'
import { CLIENT_CSS } from './styles.js'

const NS = 'excalidrawCanvas'
const BODY_ID = '@local/dsh-excalidraw-preview/canvas'
const SHARED_KEY = '__DSH_EXCALIDRAW_SHARED__'
const CANVAS_GLOBAL = '__DshExcalidrawCanvas'
const previewTokens = new Map()

const zh = {
  viewerTitle: 'Excalidraw 画布',
  loading: '正在加载官方 Excalidraw 画布…',
  loadFailed: '无法加载 Excalidraw 画布',
  retry: '重试',
  edit: '编辑',
  done: '完成编辑',
  readOnly: '只读预览',
  locked: 'Agent 正在处理，画布暂时只读',
  saving: '保存中…',
  saved: '已保存',
  unsaved: '未保存',
  offline: '连接中断，修改已保留',
  conflict: '文件已被外部修改，自动保存已停止',
  conflictBody: '画布中还有未保存的修改。请先下载草稿，或确认丢弃草稿后加载最新文件。',
  loadLatest: '加载最新文件',
  downloadDraft: '下载草稿',
  discardDraft: '丢弃草稿',
  draftFound: '发现上次未保存的草稿',
  draftFoundBody: '草稿基于当前文件版本，可以恢复。',
  draftStale: '发现基于旧版本的草稿',
  draftStaleBody: '草稿版本已过期，恢复可能覆盖 Agent 的修改。建议先下载草稿。',
  restoreDraft: '恢复草稿',
  draftTooLarge: '草稿过大，无法写入浏览器会话存储；请下载草稿',
  exported: '导出完成',
  exportFailed: '导出失败',
  exporting: '正在导出…',
  exportingHint: '官方渲染器正在绘制整张画布',
  downloadExport: '下载导出文件',
  cancel: '取消',
  empty: '这张图还没有可见元素',
  reload: '重新加载',
  conflictLoadConfirm: '加载最新文件会丢弃当前未保存的草稿。确定继续吗？',
  storageUnavailable: '浏览器会话存储不可用，草稿仅保留在内存中，关闭页面后无法恢复。',
  sessionUnavailable: '当前 Session 不可编辑，或 Host 连接已断开。',
  unsupported: '这个文件不是 Excalidraw 源文件。',
  zoom: '画布缩放与平移由官方 Excalidraw 处理；滚轮以画布中心为准。',
}

const en = {
  viewerTitle: 'Excalidraw canvas',
  loading: 'Loading the official Excalidraw canvas…',
  loadFailed: 'Could not load the Excalidraw canvas',
  retry: 'Retry',
  edit: 'Edit',
  done: 'Done editing',
  readOnly: 'Read-only preview',
  locked: 'The Agent is working; the canvas is temporarily read-only',
  saving: 'Saving…',
  saved: 'Saved',
  unsaved: 'Unsaved',
  offline: 'Connection lost; changes are preserved',
  conflict: 'The file changed externally; autosave is stopped',
  conflictBody: 'The canvas still has unsaved changes. Download the draft, or confirm discarding it and load the latest file.',
  loadLatest: 'Load latest',
  downloadDraft: 'Download draft',
  discardDraft: 'Discard draft',
  draftFound: 'An unsaved draft was found',
  draftFoundBody: 'The draft is based on the current file version and can be restored.',
  draftStale: 'An older draft was found',
  draftStaleBody: 'The draft version is stale; restoring could overwrite Agent changes. Download the draft instead.',
  restoreDraft: 'Restore draft',
  draftTooLarge: 'The draft is too large for browser session storage; download it to keep it',
  exported: 'Export complete',
  exportFailed: 'Export failed',
  exporting: 'Exporting…',
  exportingHint: 'The official renderer is drawing the whole canvas',
  downloadExport: 'Download exported file',
  cancel: 'Cancel',
  empty: 'This diagram has no visible elements',
  reload: 'Reload',
  conflictLoadConfirm: 'Loading the latest file discards the unsaved draft. Continue?',
  storageUnavailable: 'Browser session storage is unavailable; the draft lives only in memory and cannot survive closing the page.',
  sessionUnavailable: 'This Session is not editable, or the Host connection is gone.',
  unsupported: 'This file is not an Excalidraw source file.',
  zoom: 'The official Excalidraw canvas owns zoom and pan; the wheel anchors to the canvas pointer.',
}

const STATUS_LABEL = {
  saved: 'saved',
  unsaved: 'unsaved',
  saving: 'saving',
  offline: 'offline',
  locked: 'locked',
  conflict: 'conflict',
  error: 'exportFailed',
}

function h(type, props, ...children) {
  return React.createElement(type, props, ...children)
}

function assetUrl(name) {
  return new URL(`api/excalidraw-assets/${name}`, document.baseURI).href
}

function detectTheme() {
  const root = document.documentElement
  if (root.dataset?.theme === 'dark') return 'dark'
  if (root.classList?.contains('dark')) return 'dark'
  return 'light'
}

function createAssets() {
  let styleLink
  let stylePromise
  const scripts = new Set()
  return {
    ensureStyles() {
      if (stylePromise !== undefined) return stylePromise
      stylePromise = new Promise((resolve, reject) => {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = assetUrl('index.css')
        link.dataset.dshExcalidraw = 'style'
        link.onload = () => resolve()
        link.onerror = () => reject(new ApiError('ASSET_FAILED', 'cannot load the official Excalidraw stylesheet'))
        styleLink = link
        document.head.appendChild(link)
      })
      return stylePromise
    },
    async ensureCanvas() {
      if (window[CANVAS_GLOBAL] !== undefined) return window[CANVAS_GLOBAL]
      if (this.canvasPromise !== undefined) return this.canvasPromise
      window[SHARED_KEY] = { React, ReactDOM, jsxRuntime }
      window.EXCALIDRAW_ASSET_PATH = new URL('api/excalidraw-assets/', document.baseURI).href
      this.canvasPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = assetUrl('canvas.js')
        script.async = true
        script.dataset.dshExcalidraw = 'canvas'
        script.onload = () => {
          if (window[CANVAS_GLOBAL] === undefined) {
            reject(new ApiError('ASSET_FAILED', 'the official Excalidraw canvas bundle did not register'))
            return
          }
          resolve(window[CANVAS_GLOBAL])
        }
        script.onerror = () => {
          this.canvasPromise = undefined
          reject(new ApiError('ASSET_FAILED', 'cannot load the official Excalidraw canvas bundle'))
        }
        scripts.add(script)
        document.head.appendChild(script)
      })
      return this.canvasPromise
    },
    dispose() {
      if (styleLink !== undefined) styleLink.remove()
      styleLink = undefined
      stylePromise = undefined
      for (const script of scripts) script.remove()
      scripts.clear()
    },
  }
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function signatureOf(elements, files, appStatePatch) {
  return `${JSON.stringify(elements)}|${filesSignature(files)}|${JSON.stringify(appStatePatch)}`
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function textToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text))
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma === -1 ? '' : result.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('cannot read the exported blob'))
    reader.readAsDataURL(blob)
  })
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function baseName(path) {
  const parts = String(path).replace(/\\/g, '/').split('/')
  return parts.at(-1) ?? 'diagram'
}

function withoutExtension(name) {
  return name.replace(/\.[^.]+$/u, '')
}

function PreviewWatcher({ sessionId, openResource }) {
  React.useEffect(() => {
    if (!sessionId || typeof openResource !== 'function') return undefined
    let cancelled = false
    let opening = false
    const tick = async () => {
      if (cancelled || opening) return
      try {
        const pending = await pendingPreview(sessionId)
        if (cancelled || pending === null || pending === undefined) return
        opening = true
        const key = `${sessionId}\u0000${pending.path}`
        previewTokens.set(key, pending.token)
        const address = sessionFileAddress(sessionId, pending.path)
        try {
          openResource(address)
          await markPreviewOpened(sessionId, pending.token)
        } catch {
          // The preview type may not be registered yet; retry on the next tick.
        }
      } catch {
        // Connection hiccups are retried; the tool result remains the source of truth.
      } finally {
        opening = false
      }
    }
    tick()
    const timer = setInterval(tick, 1200)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId, openResource])
  return null
}

function CanvasBody(props) {
  const {
    sessionId,
    resourceAddress,
    content,
    addResource,
    assets,
    themeStore,
    t,
  } = props
  const parsed = React.useMemo(() => parseFileAddress(resourceAddress), [resourceAddress])
  const path = parsed?.path
  const [phase, setPhase] = React.useState('loading')
  const [errorText, setErrorText] = React.useState('')
  const [runtime, setRuntime] = React.useState(undefined)
  const [documentState, setDocumentState] = React.useState(undefined)
  const [editable, setEditable] = React.useState(false)
  const [working, setWorking] = React.useState(false)
  const [transactionLock, setTransactionLock] = React.useState(false)
  const [status, setStatus] = React.useState('saved')
  const statusRef = React.useRef('saved')
  const [statusText, setStatusText] = React.useState('')
  const [draftInfo, setDraftInfo] = React.useState(undefined)
  const [draftTooLarge, setDraftTooLarge] = React.useState(false)
  const [conflict, setConflict] = React.useState(undefined)
  const [exportState, setExportState] = React.useState(undefined)
  const [theme, setTheme] = React.useState(themeStore.get())
  const [reloadTick, setReloadTick] = React.useState(0)

  const apiRef = React.useRef(undefined)
  const excalidrawApiRef = React.useRef(undefined)
  const containerRef = React.useRef(null)
  const canvasHostRef = React.useRef(null)
  const documentRef = React.useRef(undefined)
  const versionRef = React.useRef('')
  const editableRef = React.useRef(false)
  const dirtyRef = React.useRef(false)
  const lastSigRef = React.useRef('')
  const savingRef = React.useRef(false)
  const pendingSaveRef = React.useRef(false)
  const pendingFlushRef = React.useRef(undefined)
  const pendingRetryRef = React.useRef(undefined)
  const inflightRef = React.useRef(undefined)
  const pollingRef = React.useRef(false)
  const suppressRef = React.useRef(false)
  const draftRef = React.useRef(undefined)
  const draftKeyRef = React.useRef('')
  const draftTimerRef = React.useRef(undefined)
  const saveTimerRef = React.useRef(undefined)
  const retryTimerRef = React.useRef(undefined)
  const pollTimerRef = React.useRef(undefined)
  const mountedRef = React.useRef(true)
  const lastRectRef = React.useRef(undefined)
  const exportInFlightRef = React.useRef(new Set())
  const bootstrapRef = React.useRef(false)
  const lastRevisionRef = React.useRef(undefined)

  editableRef.current = editable

  React.useEffect(() => {
    return themeStore.subscribe(() => setTheme(themeStore.get()))
  }, [themeStore])
  React.useEffect(() => {
    if (exportState?.kind !== 'done' && exportState?.kind !== 'failed') return undefined
    const timer = setTimeout(() => setExportState(undefined), 6000)
    return () => clearTimeout(timer)
  }, [exportState])


  const setEditableBoth = React.useCallback((next) => {
    editableRef.current = next
    setEditable(next)
  }, [])

  const setStatusBoth = React.useCallback((next, text = '') => {
    statusRef.current = next
    setStatus(next)
    setStatusText(text)
  }, [])

  const ackFlush = React.useCallback(async (flushId, error) => {
    if (!flushId || apiRef.current === undefined) return
    try {
      await apiRef.current.ack({ flushId, version: versionRef.current, ...(error === undefined ? {} : { error }) })
    } catch {
      // The Host may already have resolved the flush from a successful commit.
    }
  }, [])

  const currentEditorState = React.useCallback(() => {
    const api = excalidrawApiRef.current
    if (api === undefined) return undefined
    const elements = api.getSceneElements()
    const files = api.getFiles()
    const appState = api.getAppState()
    const appStatePatch = pickAppStatePatch(appState, documentRef.current?.appState ?? {})
    const signature = signatureOf(elements, files, appStatePatch)
    return { elements, files, appState, appStatePatch, signature }
  }, [])

  const saveDraftNow = React.useCallback(() => {
    const state = currentEditorState()
    if (state === undefined || !dirtyRef.current) return
    const draft = makeDraft({
      sessionId,
      path,
      baseVersion: versionRef.current,
      elements: state.elements,
      files: state.files,
      appStatePatch: state.appStatePatch,
    })
    draftRef.current = draft
    const key = draftKeyRef.current || draftStorageKey(sessionId, path)
    draftKeyRef.current = key
    try {
      const result = saveDraft(globalThis.sessionStorage, key, draft)
      if (!result.saved && result.reason === 'too-large') setDraftTooLarge(true)
      if (!result.saved && result.reason === 'storage') setDraftTooLarge(false)
    } catch {
      setDraftTooLarge(false)
    }
  }, [currentEditorState, path, sessionId])

  const scheduleDraft = React.useCallback(() => {
    clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(saveDraftNow, 300)
  }, [saveDraftNow])

  const syncFromSource = React.useCallback((result) => {
    const api = excalidrawApiRef.current
    if (api !== undefined) {
      const current = api.getAppState()
      const appState = {
        ...(result.document.appState ?? {}),
        scrollX: current.scrollX,
        scrollY: current.scrollY,
        zoom: current.zoom,
        width: current.width,
        height: current.height,
        theme,
      }
      suppressRef.current = true
      api.updateScene({
        elements: result.document.elements,
        appState,
        files: result.document.files ?? {},
        captureUpdate: 'NEVER',
      })
      setTimeout(() => {
        suppressRef.current = false
      }, 0)
    }
    documentRef.current = result.document
    versionRef.current = String(result.version)
    setDocumentState(result.document)
    setConflict(undefined)
    inflightRef.current = undefined
    dirtyRef.current = false
    lastSigRef.current = signatureOf(result.document.elements, result.document.files ?? {}, {})
    setStatusBoth('saved')
    setWorking(Boolean(result.working))
    content?.loaded?.(result.version)
  }, [content, setStatusBoth, theme])

  const refreshFromHost = React.useCallback(async () => {
    if (apiRef.current === undefined) return
    try {
      const snapshot = await apiRef.current.snapshot()
      syncFromSource(snapshot)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'OFFLINE') {
        setStatusBoth('offline')
      } else {
        setStatusBoth('error', error instanceof Error ? error.message : String(error))
      }
    }
  }, [setStatusBoth, syncFromSource])

  const commitNow = React.useCallback(async ({ flushId, retryBody } = {}) => {
    const api = apiRef.current
    if (api === undefined) return
    const state = currentEditorState()
    if (state === undefined) {
      if (retryBody !== undefined) {
        // The canvas is still mounting; retry the exact body rather than
        // inventing a new baseline.
        inflightRef.current = retryBody
        return
      }
      if (!dirtyRef.current) await ackFlush(flushId)
      else await ackFlush(flushId, 'the canvas is still loading')
      return
    }
    if (statusRef.current === 'conflict') {
      inflightRef.current = undefined
      await ackFlush(flushId, 'the canvas has an unresolved conflict')
      return
    }
    if (!dirtyRef.current && retryBody === undefined) {
      setStatusBoth('saved')
      await ackFlush(flushId)
      return
    }
    if (savingRef.current) {
      pendingSaveRef.current = true
      if (flushId) pendingFlushRef.current = flushId
      if (retryBody !== undefined) pendingRetryRef.current = retryBody
      return
    }
    savingRef.current = true
    setStatusBoth('saving')
    const body = retryBody ?? {
      baseVersion: versionRef.current,
      opId: randomId(),
      elements: state.elements,
      files: state.files,
      appStatePatch: state.appStatePatch,
      ...(flushId ? { flushId } : {}),
    }
    const bodySignature = signatureOf(body.elements, body.files, body.appStatePatch)
    const bodyFlushId = body.flushId
    inflightRef.current = body
    try {
      const result = await api.commit(body)
      inflightRef.current = undefined
      versionRef.current = String(result.version)
      documentRef.current = {
        ...(documentRef.current ?? { type: 'excalidraw', version: 2, elements: [] }),
        elements: body.elements,
        files: body.files,
        appState: { ...(documentRef.current?.appState ?? {}), ...body.appStatePatch },
      }
      lastSigRef.current = bodySignature
      const live = currentEditorState()
      if (live !== undefined && live.signature === bodySignature) {
        dirtyRef.current = false
        removeDraft(globalThis.sessionStorage, draftKeyRef.current)
        draftRef.current = undefined
        setDraftTooLarge(false)
        setStatusBoth('saved')
        await ackFlush(bodyFlushId)
      } else {
        dirtyRef.current = true
        setStatusBoth('unsaved')
        await ackFlush(bodyFlushId)
        scheduleSave()
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'VERSION_CONFLICT') {
          inflightRef.current = undefined
          setStatusBoth('conflict')
          setConflict({ currentVersion: error.currentVersion })
          await ackFlush(bodyFlushId, error.message)
        } else if (error.code === 'LOCKED') {
          inflightRef.current = undefined
          setStatusBoth('locked')
          setEditableBoth(false)
          saveDraftNow()
          await ackFlush(bodyFlushId, error.message)
        } else if (error.code === 'OFFLINE' || error.code === 'TIMEOUT') {
          setStatusBoth('offline')
          saveDraftNow()
          await ackFlush(bodyFlushId, error.message)
          clearTimeout(retryTimerRef.current)
          retryTimerRef.current = setTimeout(() => {
            if (mountedRef.current && inflightRef.current !== undefined) {
              commitNow({ retryBody: inflightRef.current })
            }
          }, 2000)
        } else {
          inflightRef.current = undefined
          setStatusBoth('error', error.message)
          saveDraftNow()
          await ackFlush(bodyFlushId, error.message)
        }
      } else {
        inflightRef.current = undefined
        setStatusBoth('error', error instanceof Error ? error.message : String(error))
        saveDraftNow()
        await ackFlush(bodyFlushId, 'commit failed')
      }
    } finally {
      savingRef.current = false
      if (pendingFlushRef.current !== undefined) {
        const next = pendingFlushRef.current
        pendingFlushRef.current = undefined
        await ackFlush(next)
      }
      if (pendingRetryRef.current !== undefined) {
        const next = pendingRetryRef.current
        pendingRetryRef.current = undefined
        if (mountedRef.current) commitNow({ retryBody: next })
      } else if (pendingSaveRef.current && mountedRef.current) {
        pendingSaveRef.current = false
        if (statusRef.current !== 'conflict') scheduleSave()
      }
    }
  }, [ackFlush, currentEditorState, saveDraftNow, setEditableBoth, setStatusBoth])

  function scheduleSave() {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      if (mountedRef.current) commitNow()
    }, 500)
  }

  const handleChange = React.useCallback((elements, appState, files) => {
    if (suppressRef.current || !editableRef.current) return
    const appStatePatch = pickAppStatePatch(appState, documentRef.current?.appState ?? {})
    const signature = signatureOf(elements, files, appStatePatch)
    if (signature === lastSigRef.current) return
    dirtyRef.current = true
    setStatusBoth('unsaved')
    scheduleDraft()
    scheduleSave()
  }, [scheduleDraft, scheduleSave, setStatusBoth])

  const renderExport = React.useCallback(async (task) => {
    const canvas = await assets.ensureCanvas()
    const source = task.document
    const elements = (source.elements ?? []).filter((element) => element.isDeleted !== true)
    const files = source.files ?? {}
    const appState = {
      ...(source.appState ?? {}),
      exportBackground: task.transparent !== true,
      viewBackgroundColor: source.appState?.viewBackgroundColor ?? '#ffffff',
      exportWithDarkMode: false,
      exportPadding: 16,
    }
    const name = withoutExtension(baseName(task.path))
    if (task.format === 'png') {
      const budget = checkPngBudget(source, task.scale, 16)
      if (!budget.ok) throw new ApiError('EXPORT_TOO_LARGE', budget.reason)
      appState.exportScale = task.scale
      const blob = await canvas.exportToBlob({
        elements,
        appState,
        files,
        mimeType: 'image/png',
        quality: 1,
        exportPadding: 16,
        scale: task.scale,
      })
      if (blob.size > 32 * 1024 * 1024) throw new ApiError('EXPORT_TOO_LARGE', 'the PNG exceeds 32 MiB')
      return { data: await blobToBase64(blob), blob, name: `${name}.png` }
    }
    appState.exportScale = 1
    const svg = await canvas.exportToSvg({
      elements,
      appState,
      files,
      exportPadding: 16,
      renderEmbeddables: false,
    })
    const text = new XMLSerializer().serializeToString(svg)
    const bytes = new TextEncoder().encode(text)
    if (bytes.byteLength > 32 * 1024 * 1024) throw new ApiError('EXPORT_TOO_LARGE', 'the SVG exceeds 32 MiB')
    return { data: bytesToBase64(bytes), blob: new Blob([text], { type: 'image/svg+xml' }), name: `${name}.svg` }
  }, [assets])

  const runExport = React.useCallback(async (task) => {
    if (apiRef.current === undefined || exportInFlightRef.current.has(task.taskId)) return
    exportInFlightRef.current.add(task.taskId)
    setExportState({ kind: 'working' })
    try {
      const claim = await apiRef.current.claimExport(task.taskId)
      const rendered = await renderExport(claim)
      const result = await apiRef.current.resultExport(task.taskId, {
        version: claim.version,
        format: claim.format,
        data: rendered.data,
      })
      triggerDownload(rendered.blob, rendered.name)
      setExportState({
        kind: 'done',
        name: rendered.name,
        url: result.downloadUrl,
        expiresAt: result.expiresAt,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportState({ kind: 'failed', message })
      await apiRef.current.failExport(task.taskId, message)
    } finally {
      exportInFlightRef.current.delete(task.taskId)
    }
  }, [renderExport])

  const poll = React.useCallback(async () => {
    if (pollingRef.current || apiRef.current === undefined || !mountedRef.current) return
    pollingRef.current = true
    try {
      const result = await apiRef.current.poll({
        knownVersion: versionRef.current,
        dirty: dirtyRef.current,
      })
      if (!mountedRef.current) return
      setWorking(Boolean(result.working))
      setTransactionLock(Boolean(result.transaction))
      if (result.missing) {
        setStatusBoth('error', t('sessionUnavailable'))
        return
      }
      if (result.flush !== null && result.flush !== undefined) {
        await commitNow({ flushId: result.flush.id })
      }
      for (const task of result.exports ?? []) {
        if (!exportInFlightRef.current.has(task.taskId)) void runExport(task)
      }
      if (result.externalChange === true) {
        if (dirtyRef.current && inflightRef.current === undefined) {
          setStatusBoth('conflict')
          setConflict({ currentVersion: result.version })
        } else if (!dirtyRef.current) {
          await refreshFromHost()
        }
      } else if (String(result.version) !== versionRef.current) {
        if (dirtyRef.current && inflightRef.current === undefined) {
          setStatusBoth('conflict')
          setConflict({ currentVersion: result.version })
        } else if (!dirtyRef.current) {
          await refreshFromHost()
        }
      }
      if ((result.working || result.transaction) && editableRef.current) {
        setEditableBoth(false)
        setStatusBoth('locked')
        if (dirtyRef.current && !result.transaction) await commitNow()
      }
      if (!result.working && statusRef.current === 'locked' && !result.transaction) {
        setStatusBoth(dirtyRef.current ? 'unsaved' : 'saved')
      }
    } catch (error) {
      if (!mountedRef.current) return
      if (error instanceof ApiError) {
        if (error.code === 'OFFLINE' || error.code === 'TIMEOUT') setStatusBoth('offline')
        else if (error.code === 'UNAUTHORIZED' || error.code === 'NOT_OPEN') setStatusBoth('error', t('sessionUnavailable'))
      }
    } finally {
      pollingRef.current = false
    }
  }, [commitNow, refreshFromHost, runExport, setEditableBoth, setStatusBoth, t])

  const bootstrap = React.useCallback(async () => {
    bootstrapRef.current = false
    setPhase('loading')
    setErrorText('')
    try {
      if (path === undefined || sessionId === undefined) throw new ApiError('INVALID_ADDRESS', t('unsupported'))
      await assets.ensureStyles()
      const canvas = await assets.ensureCanvas()
      if (!mountedRef.current) return
      setRuntime(canvas)
      const key = `${sessionId}\u0000${path}`
      const previewToken = previewTokens.get(key)
      let result
      try {
        result = await createCanvasApi({ sessionId, path, token: undefined }).open(previewToken)
      } catch (error) {
        if (previewToken !== undefined && error instanceof ApiError && error.code === 'UNAUTHORIZED') {
          result = await createCanvasApi({ sessionId, path, token: undefined }).open(undefined)
        } else {
          throw error
        }
      }
      if (!mountedRef.current) return
      previewTokens.set(`${sessionId}\u0000${result.path}`, result.token)
      apiRef.current = createCanvasApi({ sessionId, token: result.token, path: result.path })
      documentRef.current = result.document
      versionRef.current = String(result.version)
      lastSigRef.current = signatureOf(result.document.elements, result.document.files ?? {}, {})
      setDocumentState(result.document)
      setWorking(Boolean(result.working))
      setPhase('ready')
      content?.loaded?.(result.version)
      addResource?.(sessionFileAddress(sessionId, result.path))
      const draftKey = draftStorageKey(sessionId, result.path)
      draftKeyRef.current = draftKey
      const draft = loadDraft(globalThis.sessionStorage, draftKey)
      if (draft !== undefined) {
        setDraftInfo({
          draft,
          key: draftKey,
          matches: draft.baseVersion === String(result.version),
        })
      }
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = setInterval(() => {
        if (mountedRef.current) void poll()
      }, 900)
    } catch (error) {
      if (!mountedRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      setPhase('error')
      setErrorText(message)
      content?.failed?.()
    }
  }, [addResource, assets, content, path, poll, sessionId, t])

  React.useEffect(() => {
    mountedRef.current = true
    bootstrap()
    return () => {
      mountedRef.current = false
      clearInterval(pollTimerRef.current)
      clearTimeout(draftTimerRef.current)
      clearTimeout(saveTimerRef.current)
      clearTimeout(retryTimerRef.current)
      const api = apiRef.current
      if (api !== undefined) {
        const finish = async () => {
          try {
            if (dirtyRef.current) await commitNow()
          } catch {
            // The bounded draft remains in sessionStorage.
          } finally {
            await api.close()
          }
        }
        void finish()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (phase !== 'ready' || documentState === undefined) return
    const revision = content?.revision
    if (lastRevisionRef.current === undefined) {
      lastRevisionRef.current = revision
      return
    }
    if (revision !== lastRevisionRef.current) {
      lastRevisionRef.current = revision
      void refreshFromHost()
    }
  }, [content?.revision, documentState, phase, refreshFromHost])

  React.useEffect(() => {
    const node = containerRef.current
    if (node === null) return undefined
    const update = () => {
      const api = excalidrawApiRef.current
      if (api === undefined) return
      lastRectRef.current = node.getBoundingClientRect()
      ReactDOM.flushSync(() => {
        api.refresh?.()
      })
    }
    const observer = new ResizeObserver(update)
    observer.observe(node)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [phase])

  React.useEffect(() => {
    const handler = (event) => {
      if (dirtyRef.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const handlePointerCapture = (event) => {
    const node = containerRef.current
    if (node === null) return
    const rect = node.getBoundingClientRect()
    if (originMoved(lastRectRef.current, rect)) {
      lastRectRef.current = rect
      const api = excalidrawApiRef.current
      if (api !== undefined) ReactDOM.flushSync(() => api.refresh?.())
    }
  }

  const handleExcalidrawApi = (api) => {
    excalidrawApiRef.current = api
    if (containerRef.current !== null) lastRectRef.current = containerRef.current.getBoundingClientRect()
    setTimeout(() => {
      api.refresh?.()
      try { api.scrollToContent?.(undefined, { fitToContent: true }) } catch {}
    }, 0)
  }

  const restoreDraft = () => {
    const info = draftInfo
    if (info === undefined || info.matches === false) return
    const api = excalidrawApiRef.current
    if (api === undefined) return
    suppressRef.current = true
    api.updateScene({
      elements: info.draft.elements,
      appState: { ...(documentRef.current?.appState ?? {}), ...(info.draft.appStatePatch ?? {}), theme },
      files: info.draft.files ?? {},
      captureUpdate: 'NEVER',
    })
    dirtyRef.current = true
    setDraftInfo(undefined)
    setStatusBoth('unsaved')
    scheduleSave()
    setTimeout(() => {
      suppressRef.current = false
    }, 0)
  }

  const discardDraft = () => {
    removeDraft(globalThis.sessionStorage, draftKeyRef.current)
    draftRef.current = undefined
    setDraftInfo(undefined)
    setDraftTooLarge(false)
  }

  const downloadCurrentDraft = () => {
    saveDraftNow()
    const draft = draftRef.current ?? makeDraft({
      sessionId,
      path,
      baseVersion: versionRef.current,
      elements: excalidrawApiRef.current?.getSceneElements?.() ?? [],
      files: excalidrawApiRef.current?.getFiles?.() ?? {},
      appStatePatch: {},
    })
    downloadDraft(draft, `${withoutExtension(baseName(path))}.draft.excalidraw`)
  }

  const loadLatest = async () => {
    if (!window.confirm(t('conflictLoadConfirm'))) return
    setEditableBoth(false)
    dirtyRef.current = false
    removeDraft(globalThis.sessionStorage, draftKeyRef.current)
    setDraftInfo(undefined)
    await refreshFromHost()
  }

  if (phase === 'loading') {
    return h('div', { className: 'dsh-excalidraw-plugin dsh-excalidraw-state', role: 'status' },
      h('div', { className: 'dsh-excalidraw-spinner', 'aria-hidden': 'true' }),
      h('p', null, t('loading')),
    )
  }

  if (phase === 'error') {
    return h('div', { className: 'dsh-excalidraw-plugin dsh-excalidraw-state', role: 'alert' },
      h('p', { className: 'dsh-excalidraw-error-title' }, t('loadFailed')),
      h('p', { className: 'dsh-excalidraw-error-body' }, errorText || t('sessionUnavailable')),
      h('div', { className: 'dsh-excalidraw-actions' },
        h('button', {
          type: 'button',
          className: 'dsh-excalidraw-button dsh-excalidraw-button-primary',
          onClick: () => {
            setReloadTick((value) => value + 1)
            bootstrap()
          },
        }, t('retry')),
        dirtyRef.current ? h('button', {
          type: 'button',
          className: 'dsh-excalidraw-button',
          onClick: downloadCurrentDraft,
        }, t('downloadDraft')) : null,
      ),
    )
  }

  const initialData = {
    elements: documentState?.elements ?? [],
    appState: {
      ...(documentState?.appState ?? {}),
      viewBackgroundColor: documentState?.appState?.viewBackgroundColor ?? '#ffffff',
      theme,
      scrollToContent: true,
    },
    files: documentState?.files ?? {},
    scrollToContent: true,
  }
  const statusLabel = t(STATUS_LABEL[status] ?? 'saved')
  const conflictCurrent = conflict?.currentVersion
  const canEdit = !working && !transactionLock && conflict === undefined && phase === 'ready'

  return h('div', {
    className: 'dsh-excalidraw-plugin',
    ref: containerRef,
    onPointerDownCapture: handlePointerCapture,
    'data-editable': editable ? 'true' : 'false',
    'data-working': working ? 'true' : 'false',
  },
    h('div', { className: 'dsh-excalidraw-toolbar' },
      h('div', { className: 'dsh-excalidraw-toolbar-title' },
        h('span', { className: 'dsh-excalidraw-dot', 'data-status': status, 'aria-hidden': 'true' }),
        h('span', null, editable ? statusLabel : (working ? t('locked') : t('readOnly'))),
      ),
      h('div', { className: 'dsh-excalidraw-actions' },
        editable
          ? h('button', {
            type: 'button',
            className: 'dsh-excalidraw-button dsh-excalidraw-button-primary',
            onClick: async () => {
              await commitNow()
              setEditableBoth(false)
              setStatusBoth(dirtyRef.current ? 'unsaved' : 'saved')
            },
          }, t('done'))
          : h('button', {
            type: 'button',
            className: 'dsh-excalidraw-button dsh-excalidraw-button-primary',
            disabled: !canEdit,
            onClick: async () => {
              const snapshot = await apiRef.current?.snapshot().catch(() => undefined)
              if (snapshot !== undefined && String(snapshot.version) !== versionRef.current) {
                if (dirtyRef.current) {
                  setStatusBoth('conflict')
                  setConflict({ currentVersion: snapshot.version })
                  return
                }
                syncFromSource(snapshot)
              }
              setEditableBoth(true)
              setStatusBoth(dirtyRef.current ? 'unsaved' : 'saved')
              setTimeout(() => excalidrawApiRef.current?.refresh?.(), 0)
            },
          }, t('edit')),
        h('button', {
          type: 'button',
          className: 'dsh-excalidraw-button',
          onClick: () => {
            setReloadTick((value) => value + 1)
            void refreshFromHost()
          },
        }, t('reload')),
      ),
    ),
    working ? h('div', { className: 'dsh-excalidraw-banner', 'data-tone': 'locked', role: 'status' }, t('locked')) : null,
    draftInfo !== undefined
      ? h('div', { className: 'dsh-excalidraw-banner', 'data-tone': draftInfo.matches ? 'info' : 'warn', role: 'status' },
        h('div', null,
          h('strong', null, draftInfo.matches ? t('draftFound') : t('draftStale')),
          h('span', null, ` ${draftInfo.matches ? t('draftFoundBody') : t('draftStaleBody')}`),
        ),
        h('div', { className: 'dsh-excalidraw-actions' },
          draftInfo.matches
            ? h('button', { type: 'button', className: 'dsh-excalidraw-button', onClick: restoreDraft }, t('restoreDraft'))
            : null,
          h('button', { type: 'button', className: 'dsh-excalidraw-button', onClick: downloadCurrentDraft }, t('downloadDraft')),
          h('button', { type: 'button', className: 'dsh-excalidraw-button', onClick: discardDraft }, t('discardDraft')),
        ),
      )
      : null,
    draftTooLarge
      ? h('div', { className: 'dsh-excalidraw-banner', 'data-tone': 'warn', role: 'alert' },
        h('span', null, t('draftTooLarge')),
        h('button', { type: 'button', className: 'dsh-excalidraw-button', onClick: downloadCurrentDraft }, t('downloadDraft')),
      )
      : null,
    conflict !== undefined
      ? h('div', { className: 'dsh-excalidraw-banner', 'data-tone': 'danger', role: 'alert' },
        h('div', null,
          h('strong', null, t('conflict')),
          h('span', null, ` ${t('conflictBody')}${conflictCurrent ? ` (current ${conflictCurrent})` : ''}`),
        ),
        h('div', { className: 'dsh-excalidraw-actions' },
          h('button', { type: 'button', className: 'dsh-excalidraw-button', onClick: downloadCurrentDraft }, t('downloadDraft')),
          h('button', { type: 'button', className: 'dsh-excalidraw-button', onClick: loadLatest }, t('loadLatest')),
        ),
      )
      : null,
    exportState !== undefined
      ? h('div', { className: 'dsh-excalidraw-banner', 'data-tone': exportState.kind === 'failed' ? 'danger' : 'info', role: 'status' },
        exportState.kind === 'working'
          ? h('span', null, `${t('exporting')} ${t('exportingHint')}`)
          : exportState.kind === 'done'
            ? h('div', { className: 'dsh-excalidraw-actions' },
              h('span', null, `${t('exported')}: ${exportState.name}`),
              h('a', {
                className: 'dsh-excalidraw-button',
                href: exportState.url,
                target: '_blank',
                rel: 'noopener noreferrer',
              }, t('downloadExport')),
            )
            : h('span', null, `${t('exportFailed')}: ${exportState.message}`),
      )
      : null,
    h('div', { className: 'dsh-excalidraw-canvas', ref: canvasHostRef },
      runtime !== undefined && documentState !== undefined
        ? h(runtime.Excalidraw, {
          excalidrawAPI: handleExcalidrawApi,
          initialData,
          viewModeEnabled: !editable,
          zenModeEnabled: false,
          theme,
          name: 'DSH Excalidraw',
          langCode: navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en',
          UIOptions: {
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              toggleTheme: false,
            },
          },
          validateEmbeddable: () => false,
          onLinkOpen: (_element, event) => {
            event?.preventDefault?.()
            event?.stopPropagation?.()
          },
          onChange: handleChange,
        })
        : null,
    ),
    h('div', { className: 'dsh-excalidraw-footer' },
      h('span', null, t('zoom')),
      statusText ? h('span', { className: 'dsh-excalidraw-status-text' }, statusText) : null,
    ),
  )
}

function apply(ctx) {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'excalidraw: locale')
  const assets = createAssets()
  ctx.effect(() => () => assets.dispose(), 'excalidraw: assets')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshExcalidraw = 'client'
    style.textContent = CLIENT_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'excalidraw: client styles')
  let theme = detectTheme()
  const themeListeners = new Set()
  ctx.effect(() => ctx.on('theme/change', () => {
    theme = detectTheme()
    for (const listener of themeListeners) listener()
  }), 'excalidraw: theme')
  const themeStore = {
    get: () => theme,
    subscribe: (listener) => {
      themeListeners.add(listener)
      return () => themeListeners.delete(listener)
    },
  }

  ctx.effect(() => ctx.documentPreviews.register({
    id: BODY_ID,
    extensions: ['excalidraw'],
    priority: 'extension',
    title: () => t('viewerTitle'),
    loading: 'renderer',
    wrap: false,
  }), 'excalidraw: document type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document',
    key: BODY_ID,
    locale: NS,
    inject: (sessionId) => ({
      sessionId,
      assets,
      themeStore,
    }),
  }, CanvasBody)), 'excalidraw: canvas body')

  const openResource = (address, options) => ctx.sidebarRight.openResource(address, options)
  ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'excalidraw-preview-watcher',
    order: 900,
  }, (props) => h(PreviewWatcher, { sessionId: props.sessionId, openResource }))), 'excalidraw: preview watcher')
}

export { apply }
export const inject = ['slots', 'locale', 'documentPreviews', 'sidebarRight']

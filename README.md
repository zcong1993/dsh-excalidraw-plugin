# Excalidraw for DeepSeek Harness

An independent DSH Cordis bundle that turns natural-language diagram requests into editable
`.excalidraw` sources, opens the official Excalidraw canvas in the right sidebar, autosaves user
edits with version-safe transactions, and exports PNG/SVG through the official renderer.

The natural-language entry lives in the independent **`excalidraw` skill** at
[`.dsh/skills/excalidraw/SKILL.md`](.dsh/skills/excalidraw/SKILL.md). The plugin is intentionally
limited to the native transport: three tools, two diagnostic commands, the source/transaction
service, and the browser canvas.

## Development standards

The engineering contract for this repository — layering, file/version rules, flush protocol, client state machine, skill conventions, security, build, testing, and the anti-pattern list — lives in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## What is in the box

| Path | Responsibility |
| --- | --- |
| `lib/host.js` | Host plugin: `excalidraw_scene`, `excalidraw_preview`, `excalidraw_export`, source transactions, HTTP edit/export transport, flush coordination. |
| `lib/client.js` | Browser plugin: document-preview registration, sidebar watcher, edit/autosave/draft/conflict state machine, export worker. |
| `lib/assets/` | Lazy official Excalidraw runtime, official CSS scoped to the plugin wrapper, 234 local WOFF2 fonts (including Xiaolai Chinese), locales, licenses. |
| `.dsh/skills/excalidraw/SKILL.md` | Lightweight skill for natural-language creation, revision, preview, and export. |
| `src/` | Host and Client source. |
| `tests/` | Document contract, transaction/lock/export service, draft, and layout-input regressions. |
| `build-host.ts`, `build-library.ts`, `canvas-entry.js` | Build scripts and the official-canvas entry. |

## Use

The skill triggers on requests such as:

```text
画一个用户→网关→服务→数据库的架构图
把当前图节点统一尺寸，保留我刚调整的位置
将当前图导出为 PNG 和 SVG
```

If the agent has not loaded the skill automatically, invoke it by name from the skill catalog.
The plugin does not register a `/excalidraw` command anymore; the skill is the lightweight entry.
The low-level diagnostic commands remain:

```text
/excalidraw-scene {"action":"read","path":"diagram.excalidraw"}
/excalidraw-export {"path":"diagram.excalidraw","format":"png","scale":2}
```

The skill instructs the agent to:

1. `excalidraw_scene` `create` or `read`/`begin`/`update`/`end`;
2. `excalidraw_preview` to open the canvas;
3. `excalidraw_export` after the canvas is connected.

The right-sidebar toolbar also has an `导出` menu (PNG 2× / PNG 3× / SVG). It exports exactly what
the page shows — including edits that are not committed yet — straight to a browser download, and
does not create a Host export task or save an attachment; that path stays with `excalidraw_export`.

## Native tool contract

### `excalidraw_scene`

`create`, `read`, `begin`, `update`, `end` over a `.excalidraw` path relative to the Session working
directory. `create` uses `createIfAbsent` and refuses an existing file, directory, or symlink.
`begin` flushes a connected user draft, locks one source version for up to 120 seconds, and returns
a `transactionId`, `version`, `deadlineAt`, and bounded scene. `update` accepts `expectedVersion`
plus exactly one of `updates` (1–200 shallow patches) or `document` (full replacement). Old
versions fail with `VERSION_CONFLICT`; there is no automatic retry or silent re-read.

Reads return a bounded summary by default (`limit` 1–200, default 50, plus `offset`/`ids`) or the
complete raw JSON with `format:"document"`. Unknown top-level and appState fields are preserved.

### `excalidraw_preview`

Registers one pending preview for the calling Session. The foreground page's watcher opens the file
in `sidebar.right.tab.document` through the official document-preview registry. The canvas starts
read-only; edit mode is available when the Agent is idle.

### `excalidraw_export`

Flushes the user draft, locks one source version, asks the connected page to render with official
`exportToBlob`/`exportToSvg`, validates the PNG allocation budget or SVG safety, stores the bytes as
a durable attachment, and returns a 60-second download link. PNG defaults to 2×; SVG embeds the
fonts. The export is the whole scene, not the viewport.

## HTTP surface

All write routes require the DSH owner browser cookie via `ctx.connection.admit()`.

```text
POST /api/excalidraw-edit/{open,snapshot,commit,poll,ack,close}
POST /api/excalidraw-preview/{pending,opened}
POST /api/excalidraw-export/{claim,fail,result}
GET  /api/excalidraw-export/source
GET  /api/excalidraw-export/download
GET  /api/excalidraw-assets/*
```

Responses are `{ok:true,value}` or `{ok:false,error:{code,message,currentVersion?}}`. Connections
carry an opaque per-preview token, a 900 ms poll, a 10 s flush deadline, version checks, and an
operation-id idempotency window. A page that stops polling is pruned after 5 seconds; its draft
remains in browser `sessionStorage`.

## Build and test

```bash
bun install --ignore-scripts          # or npm install --ignore-scripts
bun build:canvas                      # official lazy chunk + scoped CSS + fonts
bun build:host                        # lib/host.js
bun build                             # both, in the required order
bun test
```

`build:canvas` runs first because it recreates `lib/`; `build:host` then writes the Host bundle.
The canvas chunk is served lazily by the Host asset route and is not part of `client.js`.

## Install

```text
plugin_manager install_bundle /absolute/path/to/dsh-excalidraw-plugin
```

The bundle is built for the installed DSH runtime `0.2.1-rc.5`; the original task's
`0.2.2-alpha.2` engine pin was adjusted because this profile runs `0.2.1-rc.5`.

## Limits

| Item | Limit |
| --- | --- |
| Source / export bytes | 32 MiB |
| Elements | 50,000 |
| Patch | 200 elements |
| Summary page | 200 elements (default 50) |
| Draft recovery | 2 MiB UTF-16 estimate |
| Flush | 10 s |
| Transaction | 120 s |
| PNG allocation | 16,777,216 pixels; 16,384 per side |
| User change summary | 100 changes / ~32 KiB, truncated explicitly |

## Security boundaries

- Source writes use `ctx.fs` with the Session sandbox policy and `createIfAbsent` /
  `replaceIfVersion`. No Node `fs` path bypasses authorization.
- Symlinks and non-`.excalidraw` paths are rejected.
- External embeds, link navigation, remote SVG resources, scripts, and inline event handlers are
  rejected on display and on SVG export.
- Embedded images must be verified raster data URLs (PNG/JPEG/WebP/GIF).
- Unauthorized pastes cannot enter the source because editing is gated by Agent state and sandboxed
  writes.

## Verification performed

- 34 Bun unit/regression tests pass (document validation, forward bindings, patches, versions,
  locks, flush, idempotency, export validation, draft limits, layout drift).
- Installed into the live profile, tools visible to the Agent.
- Manual GUI check: the sidebar opened the official Excalidraw canvas with a Chinese four-node
  diagram, rendered the whole scene, and exported a 1012×157 PNG (Chinese glyphs present) and an
  SVG with embedded WOFF2 fonts and Chinese text.
- The edit/autosave path is covered by service-level flush/commit tests; a live drag check remains
  a user-facing manual step after the Agent turn becomes idle.

# DSH Excalidraw 插件开发规范

> 适用范围：本仓库（`@zcong/dsh-excalidraw-plugin`）及其独立 `excalidraw` skill。
> 基线：DSH `0.2.1-rc.5`、Cordis `~4.0.5`、`@excalidraw/excalidraw@0.18.0`。
> 本文是本仓库的工程约束，不是 DSH 上游的永久 API 承诺。涉及 Service、Event、Slot、Remote 的具体签名时，以当时 `cordis_inspect_query` 和实际安装包为准。

## 1. 目标与非目标

### 1.1 目标

- 用一句话需求生成**可编辑**的 `.excalidraw` 源文件。
- 在 DSH 既有右侧栏使用官方 Excalidraw 渲染，不新增服务器、端口或 iframe。
- 用户编辑自动保存；Agent 与用户在同一个源文件上安全协作。
- 官方 PNG/SVG 导出，中文和字体可用。
- 所有源文件读写都经过 Session 授权、版本检查和 sandbox policy。

### 1.2 非目标

- 不做高层自动布局、文本测量或自动排版；这些由 Agent 提供。
- 不做多人实时协同编辑。
- 不做在线分享、任意外部进程的强原子 CAS。
- 普通文件工具、shell、外部进程不参与画布草稿 flush 与协作锁。

## 2. 分层与依赖方向

```text
excalidraw Skill（自然语言工作流）
        │ 调用
        ▼
Host Tools / Commands ──► ExcalidrawService ──► ctx.fs / sandbox / attachments
        │                        ▲
        │ HTTP + token           │ flush / poll / result
        ▼                        │
Client CanvasBody ──► 官方 Excalidraw lazy chunk ──► 官方 exportToBlob / exportToSvg
```

硬约束：

1. **业务逻辑只有一份**：校验、版本、事务、flush、导出状态属于 `ExcalidrawService`；工具、命令、HTTP 路由只是适配器。
2. **Client 不直接读写源文件**：所有文件操作经 Host HTTP 与 `ctx.fs`。
3. **官方运行库只加载一份**：React/ReactDOM 来自页面共享模块表；Excalidraw 作为独立 lazy chunk 加载；禁止 CDN 或第二份 React。
4. **Skill 不承担执行**：Skill 负责工作流与提示，插件负责执行与安全强制。

## 3. 目录与职责

| 路径 | 职责 | 禁止 |
| --- | --- | --- |
| `src/host/document.js` | 纯文档契约：校验、摘要、patch、diff、序列化 | 访问 `ctx`、文件系统 |
| `src/host/service.js` | 唯一业务服务：路径、版本、事务、flush、导出 | 直接操作 DOM |
| `src/host/tools.js` | 三个模型工具的 schema、render、presentationMeta | 复制事务逻辑 |
| `src/host/commands.js` | 低层诊断命令 `/excalidraw-scene`、`/excalidraw-export` | 自然语言入口 |
| `src/host/routes.js` | 编辑/预览/导出/静态资源 HTTP 接口 | 绕过 owner 鉴权 |
| `src/host/events.js` | `agent/status`、`agent/disposed`、`agent/pre-step` | 阻塞式长任务 |
| `src/client/index.js` | 画布 body、watcher、状态机、草稿、导出 worker | 直接 `node:*` 导入 |
| `src/client/api.js` | Host HTTP 封装 | 业务判断 |
| `src/canvas/index.js` | 官方 Excalidraw 运行库入口 | 业务状态 |
| `.dsh/skills/excalidraw/SKILL.md` | 自然语言工作流 | 代替工具执行 |
| `lib/` | 构建产物（Host、Client、assets） | 手改 |
| `tests/` | 纯契约、假 fs、路由、工具与导出回归 | 依赖真实 GUI |
| `scripts/` | 构建产物与 npm tarball 的静态体检 | 业务逻辑 |
| `bunfig.toml` | 测试覆盖率门槛与报告位置 | 运行时配置 |

## 4. Host 开发规范

### 4.1 服务边界

- 所有工具、命令、路由共享同一个 `ExcalidrawService` 实例。
- Service 不保存跨 Session 的隐式“当前图”；每个操作都必须带 Session / connection token / path。
- 任何缓存（文件内容、连接、事务、导出任务）都必须有明确 key、生命周期与清理路径。

### 4.2 文件授权与写入

源文件必须通过：

```text
ctx.workingDirectory.ensure(agent)
  → ctx.fs.resolve(path, { cwd })
  → ctx.fs.lstat(path) 拒绝 symlink
  → ctx.fs.stat / readText
  → ctx.fs.writeText(target, text, intent, signal, policy)
```

规则：

- 扩展名必须是 `.excalidraw`。
- `create` 固定使用 `createIfAbsent`；创建前同时检查文件、目录和符号链接。
- `update` / 用户保存固定使用原始 baseline 的 `replaceIfVersion`。
- 写入文本必须包含末尾 `\n`；最大 32 MiB。
- 禁止用 Node `fs` 直接写源文件，禁止无条件覆盖。
- 成功写入后发出 `fs/observed` 正/负 observation，供观察策略记账。
- 源文件已提交但记账失败时，保留已提交路径/版本并明确警告，不把提交报告成失败。

### 4.3 事务

- `begin` 先 flush 连接中的用户草稿，再读取并锁定 baseline。
- 每个 canonical `targetKey` 同时只允许一个事务；事务锁跨 Session。
- `update` 必须带 `expectedVersion`，且只能使用 `begin` 返回的版本。
- 旧版本返回 `VERSION_CONFLICT`；**禁止**自动重试、重读或“洗掉”版本保护。
- 事务最长 120 秒；`update` 成功或失败都结束事务；`end` 释放未提交事务。
- `document` 整图替换会移除省略内容；`updates` 是 1–200 项浅合并，`patch.id` 禁止。
- 新增元素必须带 `type` 和完整几何；软删除使用 `isDeleted: true`。

### 4.4 Flush 协作

Host 与浏览器不是直接 RPC，使用连接轮询：

- Client 每约 900 ms `poll`，携带 `dirty` 与已知版本。
- Host 需要保存时设置 `flush` 请求，最多等 10 秒。
- Client `commit` 成功后 `ack`；Host 也可在 commit 成功时直接 resolve。
- 连接超过 5 秒没有 poll 视为 stale：从 session 集合移除，不阻塞新的 preview / begin / export。
- 强制 flush 只对 live 连接执行；不能因为一个已关闭页面把整个操作拖到超时。
- 页面仍在加载时收到 flush，若没有脏稿必须立即 ack；不能静默返回。
- 同一连接使用 `opId` 幂等；响应丢失时重试**同一个 body / opId**，不能用新 opId 重放。

### 4.5 工具输出

工具定义必须满足：

- `parameters` 是完整 JSON Schema；`action` 等封闭操作使用 `enum`。
- `output.schema` 是 lossless JSON Schema；`output.render` 只输出文本/文件块。
- `presentationMeta` 只能返回已知字符串/数字；**不能包含 `undefined`**。可选字段用条件展开：

```js
presentationMeta: (_args, value) => ({
  ...(typeof value.path === 'string' ? { path: value.path } : {}),
  ...(typeof value.version === 'string' ? { version: value.version } : {}),
})
```

- 工具错误必须可读、可操作；版本冲突带 `currentVersion`。
- 工具 `execute` 不写 `presentationMeta` 依赖的隐式状态。

### 4.6 HTTP 接口

固定接口：

```text
POST /api/excalidraw-edit/{open,snapshot,commit,poll,ack,close}
POST /api/excalidraw-preview/{pending,opened}
POST /api/excalidraw-export/{claim,fail,result}
GET  /api/excalidraw-export/source
GET  /api/excalidraw-export/download
GET  /api/excalidraw-assets/*
```

规则：

- 编辑/预览/导出接口必须用 `ctx.connection.admit(req)`，且只允许 `principal.kind === 'owner'`。
- 每个连接使用不可猜测的 per-preview token，绑定 Session 与 canonical path。
- 统一响应：`{ok:true,value}` 或 `{ok:false,error:{code,message,currentVersion?}}`。
- JSON body 上限 48 MiB；超出明确拒绝，不截断。
- 下载链接使用一次性随机 token，60 秒有效；不在 URL 里放连接 token。
- 静态资源路由只提供 `lib/assets` 内文件，做路径遍历检查；字体可长缓存，JS/CSS 使用 `no-cache`。

### 4.7 导出

- 先 flush，再读取并锁定源版本。
- 必须由已连接的 owner 页面领取任务并调用官方 `exportToBlob` / `exportToSvg`。
- PNG：默认 2×，总像素 ≤ 16,777,216，单边 ≤ 16,384。
- SVG：验证 UTF-8、`<svg>` 根、无 `<script>`、`foreignObject`、事件属性、`javascript:`、远程 `href`/`url()`。
- 结果字节 ≤ 32 MiB；空图明确失败。
- 先保存 attachment，成功后才能返回附件/下载地址；附件保存失败不得报告成功。
- 导出的源版本必须与结果版本一致。

### 4.8 原生工具与诊断命令

| 工具 | 作用 |
| --- | --- |
| `excalidraw_scene` | 对 `.excalidraw` 执行 `create` / `read` / `begin` / `update` / `end`；`begin` 锁定版本，`update` 用 `expectedVersion` 防止覆盖 |
| `excalidraw_preview` | 在右侧边栏打开画布，初始只读 |
| `excalidraw_export` | flush 用户草稿、锁定版本，由已连接页面渲染 PNG/SVG，校验后保存为附件并返回 60 秒下载链接 |

路径相对 Session 工作目录，必须以 `.excalidraw` 结尾。读取默认返回有界摘要（`limit` 1–200，默认 50，支持 `offset` / `ids`），`format: "document"` 返回完整 JSON；未知顶层字段与 `appState` 字段原样保留。

低层诊断命令：

```text
/excalidraw-scene {"action":"read","path":"diagram.excalidraw"}
/excalidraw-export {"path":"diagram.excalidraw","format":"png","scale":2}
```


## 5. Client 开发规范

### 5.1 渲染器注册

- 在 `sidebar.right.tab.document` 注册 key 为 `@zcong/dsh-excalidraw-plugin/canvas` 的 body。
- 通过 `ctx.documentPreviews.register` 注册 `extensions: ['excalidraw']`、`loading: 'renderer'`、`priority: 'extension'`。
- 官方 CSS 必须用 `.dsh-excalidraw-plugin` 前缀作用域；不得污染宿主页面。
- Body 必须保留 `height:100%; min-height:0` 链，Excalidraw 根节点使用绝对定位填满。
- 插件 chrome 使用 DSH alias token（背景、文本、边框、状态色、圆角、阴影），不硬编码主题色；根节点带 `data-dsh-theme` 与 `dir`。
- Excalidraw 的 chrome 变量映射到 DSH token；暗色覆盖需要 `.excalidraw.theme--dark` 级别特异性，否则会被官方暗色块覆盖。

### 5.2 预览打开必须幂等

- watcher 调 `ctx.sidebarRight.openResource(address)` 时**不要**传 `revealIfOpened: false`。
  该选项会让同内容文件新开 tab，导致重复画布与旧连接被关闭。
- 已打开同一文件时默认聚焦既有 tab；每次 `excalidraw_preview` 只负责创建 pending 请求。
- 打开成功后 `markPreviewOpened`；失败保留 pending 以便重试。
- 同一文件只允许一个编辑连接；`openCanvas` 发现同 path 旧连接时关闭旧连接。

### 5.3 状态机

```text
loading → ready(read-only) → editing → saving → saved
                    │           ├── offline（保留草稿，重试同一提交）
                    │           ├── conflict（停止自动保存，下载草稿/加载最新）
                    │           └── locked（Agent working / 事务进行中）
                    └── error（重试）
```

- 初始只读；Agent idle 才允许点“编辑”。
- `working` 或同文件事务存在时，编辑按钮禁用；已编辑内容先 flush 再锁定。
- 冲突状态禁止自动保存，不得静默丢弃草稿。
- 断线保留草稿；恢复后重试同一 `opId`。
- “完成编辑”必须先提交，再退出。
- 工具栏缩放（− / 比例 / + / 适应屏幕）只改本地视口 appState：围绕视口中心缩放，不进入 `appStatePatch`、不触发保存；适应屏幕调用官方 `scrollToContent({ fitToContent: true })`，空图回到 100%。百分比通过官方 `onScrollChange` 跟随滚轮缩放。
- 工具栏“导出”菜单提供 PNG 2× / PNG 3× / SVG，导出当前画面（含未提交编辑）并直接触发浏览器下载；不走 Host 导出任务、不写附件。

### 5.4 自动保存

- 变更后 500 ms 防抖提交。
- 串行保存：`savingRef` + `pendingSaveRef`；不允许并行 commit。
- 每次提交包含 `baseVersion`、`opId`、`elements`、`files`、`appStatePatch`。
- `appStatePatch` 只包含持久字段（背景色、网格、当前样式等），**不包含** viewport、selection、editingElement。
- 网络失败保留 `inflight` body，定时重试同一个 `opId`；不要用新 opId 覆盖已提交结果。
- 服务端返回 `VERSION_CONFLICT` 时停止自动保存，显示冲突，不自动加载覆盖。
- 保存成功才删除草稿；失败/冲突保留。
- 切换 Session / 关闭页签触发卸载时，必须用最近一次 `onChange` 的缓存快照同步保存草稿并提交，不能重新读取官方 API：Excalidraw 在 `componentWillUnmount` 中已把 scene 重置为空，父级 passive cleanup 再读会得到空画布并覆盖源文件。

### 5.5 草稿

- `sessionStorage` key 绑定 Session + path；最多 2 MiB（UTF-16 估算）。
- 草稿不保存连接 token。
- 存储失败或超限时保留内存草稿，并提供下载；不能假装保存成功。
- 恢复草稿前检查 `baseVersion`；旧版本草稿默认只允许下载，不直接覆盖。

### 5.6 交互准确性

- 输入 capture 阶段比较自身 DOM 原点与官方 canvas 偏移。
- 偏移变化时通过共享 `ReactDOM.flushSync` 调官方 `api.refresh()`。
- 使用 `ResizeObserver` + `window.resize`；不重载场景、不清 Undo、不重置视口、不改事件坐标。
- 保留亚像素值，不四舍五入 x/y。
- 初次加载调用 `scrollToContent(undefined, { fitToContent: true })`，让整图可见。

### 5.7 导出 worker

- poll 返回导出任务后 `claim`，用任务携带的锁定 document 渲染。
- 结果只发送 `version/format/data`；Host 负责验证、保存 attachment、返回下载地址。
- 成功后可自动下载一次，但状态条必须在数秒后自动消失；不得让“导出完成”常驻。
- 用户未要求时，Agent 不得主动导出；导出是显式工具调用。

### 5.8 生命周期

- 所有 `ctx.effect` / `ctx.on` / slot registration / `documentPreviews.register` 都要有 disposer。
- 组件卸载：清 timer、停 poll、flush 未保存草稿、关闭连接；失败时保留草稿。
- 插件卸载：关闭连接、拒绝等待中的 flush/export、清理 task/timer；不销毁用户草稿。

## 6. Skill 规范

- 自然语言入口由独立 skill 承担，插件不再注册 `/excalidraw` command。
- Skill 位于 `.dsh/skills/excalidraw/SKILL.md`，`user-invocable: true`、`disable-model-invocation: true`：只有用户显式触发才加载，模型不自动调用；`splitSkillSource` 把这个 frontmatter 映射成注册时的 `modelInvocable: false`。description 同时覆盖中英文触发词。
- Skill 只写“如何工作”和“何时用哪个工具”，不复制完整工具 schema，不复制插件实现细节。
- Skill 必须要求：
  - 不打印原始 JSON；
  - 创建用 `create`，修改用 `begin → update → end`；
  - 多候选图先问；
  - 用户编辑后先读最新 baseline；
  - 只有用户明确要求才导出（导出会弹下载/保存对话框），且导出前先预览；
  - 空图/超限/断线明确失败。
- 工具不可用时，Skill 告诉用户启用插件，不绕道普通文件写入。
- Host 启动时用 `ctx.skills.register()` 注册同一份 SKILL.md（构建时内联到 `lib/host.js`），使 npm 安装无需手动复制；项目级同名 skill 优先，可用于覆盖。

## 7. 官方运行库与资源

- Excalidraw 运行库必须构建为独立 lazy chunk：`lib/assets/canvas.js`。
- React / ReactDOM / JSX runtime 从页面共享模块表注入；禁止第二份 React。
- `window.EXCALIDRAW_ASSET_PATH` 指向 `api/excalidraw-assets/`（相对 `document.baseURI`）。
- 官方 CSS 由构建脚本用 PostCSS 加 `.dsh-excalidraw-plugin` 前缀；`:root` 的 z-index / safe-area 变量落到插件根节点，根节点必须带 `dir` 才能匹配 `:root[dir=...]` 规则；字体 URL 保持相对 CSS 的 `./fonts/...`。
- 打包全部 234 个 WOFF2 字体（含 Xiaolai 中文回退）和 locales。
- `lib/assets/LICENSE-excalidraw` 与 `THIRD_PARTY_NOTICES.md` 必须随包发布。
- 禁止从 CDN 加载画布、字体或 React。

## 8. 构建、测试与安装

```bash
pnpm install           # 依赖管理，与 DSH profile 保持一致
pnpm run lint          # oxlint，correctness + 未使用变量
pnpm exec tsc --noEmit # 两个构建脚本的类型检查
bun run build          # build:canvas → build:host
node scripts/verify-build.mjs
bun test --coverage    # 行覆盖门槛 70%
pnpm pack --pack-destination .tmp/pkg
node scripts/verify-package.mjs .tmp/pkg/*.tgz
```

- `build:canvas` 会重建 `lib/`，因此必须在 `build:host` 之前。
- `build:host` 输出 `lib/host.js`；`build:canvas` 输出 `lib/client.js` 与 `lib/assets/*`。
- 语法检查：`node --check lib/host.js lib/client.js lib/assets/canvas.js`。
- 类型检查：`pnpm exec tsc --noEmit`（`tsconfig.json` 覆盖两个构建脚本）。
- 测试覆盖：文档契约、假 fs 服务、事务锁、flush、idempotency、导出校验、HTTP 路由（鉴权/状态映射/路径遍历/下载 token）、工具 schema 与 `presentationMeta`、草稿/几何、地址与 Client HTTP 封装。
- 覆盖率：`bunfig.toml` 设 `coverageThreshold = 0.7`，以行覆盖为准；Bun 只统计被测试导入的模块，未导入的 `client/index.js` 不计入，因此门槛不等于全仓真实覆盖。
- `tests/support/host-fixture.js` 提供共享的假 fs、假 ctx 与导出握手，新测试优先复用它。
- `scripts/verify-build.mjs` 检查：CSS 每条规则以 `.dsh-excalidraw-plugin` 开头、无远程 `url()`/`@import`、`@font-face` 全部指向 `./fonts/`；字体 ≥234 且与 manifest 一致；`zh-CN`/`en` locale；license/notices；共享 React 注入与 `EXCALIDRAW_ASSET_PATH`；无 source map；产物体积预算。
- `scripts/verify-package.mjs` 检查 tarball 只含 `package.json`/README/LICENSE/`lib`/`locale`/`icon.svg`/`cordis.patch.yml`，并校验必需文件、字体数量、locale、`exports`/`dsh.bundle`/`engines.dsh`。
- CI（`.github/workflows/ci.yml`）分四个 job：`quality`（tsc + oxlint）、`test`（覆盖率 + lcov artifact + Codecov 上传）、`bundle`（build + verify + pack + verify + tarball artifact）、`install-smoke`（在全新 `DSH_HOME` 中用 `@deepseek-ai/dsh@0.2.1-rc.5` 执行 `dsh plugin add`，并断言 `--dump-config` 含插件层）。
- Codecov 用 `use_oidc: true` 上传，不保存 token；`fail_ci_if_error: false`，外部服务抖动不阻塞 PR。`codecov.yml` 的 project 门槛与 `bunfig.toml` 一致为 70%，patch 状态暂设 `informational`，等浏览器回归补齐后再考虑转成硬门槛。
- 手工验收：真实 GUI 打开画布、中文、拖动/改字/自动保存、冲突、断线、PNG/SVG 导出。
- 安装：`plugin_manager install_bundle <absolute-path>`；以 `application: applied` 和 `warnings` 判定生效。
- 修改 Client 后必须刷新页面；仅重载 Host 不会替换浏览器 bundle。
- 不要用「测试通过」替代 GUI 验收。

### 8.1 发布

发布由 `.github/workflows/release.yml` 在推送 `v*` tag 时自动完成，使用 npm 的 Trusted Publishing（OIDC）：不保存 `NPM_TOKEN`，也不需要 OTP。

一次性配置（在 npmjs.com 完成，仓库里没有可替代的步骤）：

1. 包页面 → Settings → **Trusted publishing** → 添加 GitHub Actions。
2. Repository 填 `zcong1993/dsh-excalidraw-plugin`，Workflow filename 填 `release.yml`，Environment 留空。
3. 之后只能在存在该 trusted publisher 的前提下由本 workflow 发布。

每次发版：

```bash
bun run release 0.4.0          # 版本号 + 提交 + 直推 main + 打 tag
bun run release 0.4.0 --dry-run # 只看计划，不改仓库
```

`scripts/release.ts` 会校验版本号递增、工作区干净、`main` 与 `origin/main` 一致、tag 未存在，然后改三处版本号（`package.json` 与 `README.md` 的安装版本、`^x.y.z` 依赖），本地跑 `oxlint` + `bun test`，提交 `chore(release): vX.Y.Z`，直推 `main`，最后打并推 `vX.Y.Z` tag。手工等价步骤是：改版本号 → `git commit -am "chore(release): vX.Y.Z"` → `git push origin HEAD:main` → `git tag vX.Y.Z && git push origin vX.Y.Z`。

release workflow 是这条路径的卡点：先校验 tag 与 `package.json` 一致，再跑 `tsc --noEmit`、`oxlint`、`bun test --coverage`、build、`verify-build`、`pnpm pack` + `verify-package`，并把打出的 tarball 装进全新 `DSH_HOME` 验证 `--dump-config` 含本插件；全部通过才 `npm publish --provenance` 并创建 GitHub Release。

注意：发布提交直推 `main` 时不会等 `ci.yml` 的必需检查，所以 release workflow 必须自带完整卡点，任何一步失败都不得 publish。

失败与回滚：

- tag 与版本号不一致、测试或校验失败时，workflow 不会 publish，也不会创建 release。
- 修好后删除远端 tag 重推：`git push --delete origin vX.Y.Z && git tag -f vX.Y.Z && git push origin vX.Y.Z`。
- npm 上已发布的版本无法覆盖，只能发下一个 patch 版本。
- 发布后自检：`npm view @zcong/dsh-excalidraw-plugin version`；在 profile 里 `plugin_manager install_bundle @zcong/dsh-excalidraw-plugin@X.Y.Z`，确认返回 `applied` 且 `warnings` 为空。

## 9. 安全边界

- 编辑/导出路由只允许 owner Peer；viewer/API Peer 不得获得浏览器编辑权限。
- 源文件只经 `ctx.fs` + sandbox policy；禁止 Node fs 绕过。
- 拒绝 symlink、非 `.excalidraw`、非法 JSON、重复 id、非有限数字、损 JSON。
- 图片只允许验证过的 PNG/JPEG/WebP/GIF data URL；禁止 SVG、外部 URL、`javascript:`。
- 显示安全：禁止外部嵌入、链接导航、远程 SVG 资源、脚本、内联事件。
- 粘贴只在可编辑状态进入源图；未授权粘贴不落盘。
- SVG 导出结果同样必须经过安全验证。
- 日志不得记录连接 token、附件密钥或完整源文件。

## 10. 代码风格

- Host 与 Client 均使用 ESM；Client 禁止 `node:*`、`process.cwd()`、直接 `fs`。
- 注册资源优先用 `ctx.effect` / `ctx.on`；不要留下无 disposer 的监听器/定时器。
- 业务错误使用稳定 code；面向模型的消息要说明恢复动作。
- 不在源码中保留调试 URL、debug token、临时 hook、`console.log` 噪音。
- 只提交 `src/`、测试、构建脚本、文档与资源元数据；`lib/` 与 `node_modules/` 由 `.gitignore` 排除。
- 注释解释“为什么”和边界，不复述代码。

## 11. 反模式清单

| 反模式 | 后果 | 正确做法 |
| --- | --- | --- |
| `openResource(address, { revealIfOpened: false })` | 每次预览新开 tab，旧连接失效 | 默认聚焦既有 tab |
| 无条件 `writeText` | 覆盖用户/Agent 修改 | `createIfAbsent` / `replaceIfVersion` |
| 从摘要构造整图替换 | 丢失未知字段/文件/appState | 读 raw document 或用 patch |
| 版本冲突后自动重读重试 | 洗掉版本保护 | 停止、报告 `VERSION_CONFLICT` |
| 强制 flush 已关闭页面 | 每次操作卡 10 秒 | 5 秒 stale 剪枝，只 flush live 连接 |
| `presentationMeta` 返回 `undefined` | 工具结果报 non-lossless JSON | 条件展开 |
| 将 `containerId: null` 当非法 | 合法文本元素无法创建 | 允许 `null` |
| Client 直接 `fs.write` | 绕过授权/版本 | 走 Host HTTP |
| 第二份 React / CDN 画布 | 双实例、样式/上下文错误 | 共享模块表 + lazy chunk |
| 插件注册 `/excalidraw` command | 入口逻辑重复、维护两套 prompt | 独立 skill |
| 导出状态常驻 | 用户误以为反复导出 | 完成后数秒自动消失 |

## 12. 提交与验收清单

提交前：

- [ ] `bun test --coverage` 全绿，全局行覆盖不低于 70%；普通 `bun test` 不检查门槛。
- [ ] 覆盖率只统计被测试导入的模块；改动 `client/index.js` 等未覆盖区域时，交付说明中注明手验结果。
- [ ] `bun run build` 成功，三个 JS 产物 `node --check` 通过。
- [ ] 没有 debug hook、临时 token 文件、测试截图、临时 `.excalidraw` 混入源码提交。
- [ ] `presentationMeta` / `output.schema` 全部 lossless。
- [ ] 新增/修改的资源注册有 disposer。
- [ ] 事务、flush、导出、冲突路径有测试或明确手验记录。

交付时：

- [ ] `plugin_manager install_bundle` 返回 `applied`，warnings 为空。
- [ ] GUI 实际打开画布；中文可见；缩放/平移/拖动坐标准确。
- [ ] 编辑模式下官方形状工具栏可见、可点击；暗色主题跟随 DSH 切换。
- [ ] 用户编辑自动保存；Agent working 时只读；idle 后可继续。
- [ ] 旧版本提交失败；冲突不丢草稿。
- [ ] PNG/SVG 与同一源版本一致，包含整图与中文。
- [ ] 重复预览不新开 tab。
- [ ] 说明未验证项和已知限制。

## 13. 维护约定

- 升级 DSH、Cordis 或 Excalidraw 后，先用 `cordis_inspect_list` / `cordis_inspect_query` 核对 Service、Slot、Event、工具 schema，再改代码。
- 官方 Excalidraw 升级时重点回归：`exportToSvg` 字体内嵌、`EXCALIDRAW_ASSET_PATH`、locale 加载、CSS 前缀、字体清单。
- 任何改变权限、版本语义、flush 语义或导出安全校验的提交，必须同步更新本文与 `README.md`。
- 文档与代码冲突时，以代码和实际运行结果为准，并在同一变更中修正文档。

## 14. 运行限制

| 项目 | 限制 |
| --- | --- |
| 源文件 / 导出体积 | 32 MiB |
| 元素数量 | 50,000 |
| 单次 patch | 200 个元素 |
| 摘要分页 | 200 个元素（默认 50） |
| 草稿恢复 | 2 MiB（UTF-16 估算） |
| 保存 flush | 10 秒 |
| 事务有效期 | 120 秒 |
| PNG 像素 | 16,777,216 像素，单边 16,384 |
| 用户改动摘要 | 100 条 / 约 32 KiB，超出明确截断 |
